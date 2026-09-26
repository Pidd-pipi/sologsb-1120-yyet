<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { usePartStore } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { useEstimateStore } from '../stores/estimateStore';
import { newId } from '../utils/id';
import {
  buildBaseline,
  buildPrefillItems,
  estimateStatus,
  formatDiff,
  formatMoney,
  normalizeItems,
  round2,
} from '../utils/estimate';
import { ESTIMATE_ITEM_KINDS, type Estimate, type EstimateItem } from '../types/estimate';

const route = useRoute();
const router = useRouter();
const clockStore = useClockStore();
const partStore = usePartStore();
const stepStore = useStepStore();
const estimateStore = useEstimateStore();

const clockId = ref(String(route.params.clockId ?? ''));
const clock = computed(() => clockStore.byId(clockId.value));
const parts = computed(() => partStore.byClock(clockId.value));
const steps = computed(() => stepStore.byClock(clockId.value));
const pendingStepCount = computed(() => steps.value.filter((s) => s.state !== 'done').length);
const versions = computed(() => estimateStore.byClock(clockId.value));
const status = computed(() => estimateStatus(versions.value, parts.value, steps.value));

const STATE_TAG: Record<Estimate['state'], { label: string; type: 'success' | 'warning' | 'info' }> = {
  draft: { label: '待确认', type: 'warning' },
  confirmed: { label: '已确认', type: 'success' },
  superseded: { label: '已被取代', type: 'info' },
};

// —— 草稿编辑器 ——
const editorItems = ref<EstimateItem[]>([]);
const editorNote = ref('');
const editorOperator = ref('');
const error = ref('');

const draft = computed(() => status.value.draft);
watch(
  () => [draft.value?.id, clockId.value],
  () => {
    if (draft.value) {
      editorItems.value = draft.value.items.map((it) => ({ ...it }));
      editorNote.value = draft.value.note;
    } else {
      editorItems.value = [];
      editorNote.value = '';
    }
    error.value = '';
  },
  { immediate: true },
);

const editorTotals = computed(() => {
  const norm = normalizeItems(editorItems.value);
  const labor = round2(norm.filter((it) => it.kind === 'labor').reduce((s, it) => s + it.amount, 0));
  const material = round2(norm.filter((it) => it.kind === 'material').reduce((s, it) => s + it.amount, 0));
  return { labor, material, total: round2(labor + material) };
});

/** 与已确认版本的差额（即待确认的补充金额） */
const editorDiff = computed(() =>
  status.value.confirmed ? round2(editorTotals.value.total - status.value.confirmed.total) : null,
);

/** 草稿相对已保存内容是否有改动 */
const dirty = computed(() => {
  if (!draft.value) return editorItems.value.length > 0;
  return (
    JSON.stringify(normalizeItems(editorItems.value)) !== JSON.stringify(draft.value.items) ||
    editorNote.value !== draft.value.note
  );
});

function prefill() {
  const used = new Set(editorItems.value.map((it) => it.refId).filter(Boolean));
  const additions = buildPrefillItems(parts.value, steps.value).filter((it) => !it.refId || !used.has(it.refId));
  if (additions.length === 0) {
    ElMessage.info('当前零件与待办工序已全部在明细中');
    return;
  }
  editorItems.value = [...editorItems.value, ...additions];
  ElMessage.success(`已按当前零件与待办工序补充 ${additions.length} 条明细`);
}

function addCustomRow() {
  editorItems.value = [
    ...editorItems.value,
    { id: newId('itm'), kind: 'labor', label: '', source: 'custom', qty: 1, unitPrice: 0, amount: 0 },
  ];
}

function removeRow(index: number) {
  editorItems.value = editorItems.value.filter((_, i) => i !== index);
}

function validate(): string {
  if (!clockId.value) return '请先选择钟表';
  if (editorItems.value.length === 0) return '请至少添加一条费用明细';
  for (const it of editorItems.value) {
    if (!it.label.trim()) return '明细项目说明不能为空';
    if (!(it.qty > 0)) return `「${it.label}」数量必须大于 0`;
    if (!(it.unitPrice >= 0)) return `「${it.label}」单价不能为负`;
  }
  if (!draft.value && !editorOperator.value.trim()) return '编制人（师傅）必填';
  return '';
}

async function saveDraft() {
  error.value = validate();
  if (error.value) return;
  if (draft.value) {
    await estimateStore.updateDraft(draft.value.id, editorItems.value, editorNote.value);
    ElMessage.success(`估价草稿 v${draft.value.version} 已保存`);
  } else {
    const created = await estimateStore.createDraft(
      clockId.value,
      editorItems.value,
      editorNote.value,
      editorOperator.value.trim(),
    );
    ElMessage.success(`已生成估价版本 v${created.version}，待前台确认`);
  }
}

// —— 前台确认 ——
const confirmVisible = ref(false);
const confirmer = ref('');
const confirmError = ref('');
const confirmDiff = computed(() =>
  draft.value && status.value.confirmed ? round2(draft.value.total - status.value.confirmed.total) : null,
);

function openConfirm() {
  if (!draft.value) return;
  if (dirty.value) {
    ElMessage.warning('草稿有未保存的修改，请先保存再确认');
    return;
  }
  confirmVisible.value = true;
  confirmError.value = '';
  confirmer.value = '';
}

async function submitConfirm() {
  if (!confirmer.value.trim()) {
    confirmError.value = '确认人（前台）必填';
    return;
  }
  const target = draft.value;
  if (!target) return;
  await estimateStore.confirm(target.id, confirmer.value.trim(), buildBaseline(parts.value, steps.value, target.total));
  confirmVisible.value = false;
  ElMessage.success(`估价 v${target.version} 已经前台确认，金额与基线已冻结`);
}

async function discard() {
  if (!draft.value) return;
  try {
    await ElMessageBox.confirm(`确定作废草稿 v${draft.value.version}？已确认版本不受影响。`, '作废草稿', {
      type: 'warning',
    });
  } catch {
    return;
  }
  await estimateStore.discardDraft(draft.value.id);
  ElMessage.info('草稿已作废');
}

const banner = computed(() => {
  if (versions.value.length === 0) {
    return {
      type: 'info' as const,
      title: '尚未编制估价单：按当前零件与待办工序生成明细，保存版本后由前台确认。',
      description: '',
    };
  }
  if (status.value.pending && status.value.confirmed) {
    return {
      type: 'error' as const,
      title: `已确认估价 v${status.value.confirmed.version} 待补价：${status.value.reasons.join('；')}`,
      description: `${
        status.value.diff != null ? `待确认差额 ${formatDiff(status.value.diff)}` : '差额待师傅填报补价版本'
      }；补充金额经前台确认前，该钟表不能完成维修。`,
    };
  }
  if (status.value.draft) {
    return {
      type: 'warning' as const,
      title: `估价草稿 v${status.value.draft.version} 待前台确认（合计 ${formatMoney(status.value.draft.total)}）`,
      description: '',
    };
  }
  if (status.value.confirmed) {
    return {
      type: 'success' as const,
      title: `估价 v${status.value.confirmed.version} 已确认（合计 ${formatMoney(
        status.value.confirmed.total,
      )}），确认后零件决定、工序数量与金额均未再变化。`,
      description: '',
    };
  }
  return { type: 'info' as const, title: '', description: '' };
});

onMounted(async () => {
  await clockStore.load();
  await partStore.load();
  await stepStore.load();
  await estimateStore.load();
  if (!clockId.value && clockStore.items.length > 0) {
    clockId.value = clockStore.items[0].id;
  }
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>维修估价单</h2>
      <el-select v-model="clockId" placeholder="选择钟表" style="width: 260px">
        <el-option v-for="c in clockStore.items" :key="c.id" :label="`${c.clockNo} · ${c.caliber}`" :value="c.id" />
      </el-select>
      <el-tag v-if="status.pending" type="danger">待补价</el-tag>
      <el-tag v-else-if="status.confirmed" type="success" effect="plain">已确认</el-tag>
      <div class="spacer" />
      <el-button v-if="clockId" @click="router.push(`/clocks/${clockId}`)">查看钟表详情</el-button>
      <el-button @click="router.push('/clocks')">返回台账</el-button>
    </div>

    <el-alert
      v-if="clockId && banner.title"
      :type="banner.type"
      :title="banner.title"
      :description="banner.description"
      :closable="false"
      show-icon
    />

    <template v-if="clockId">
      <el-card shadow="never">
        <template #header>
          <div class="card-head">
            <strong>{{ draft ? `草稿 v${draft.version}（待确认）` : '编制新版本' }}</strong>
            <el-tag v-if="draft" size="small" type="warning">待前台确认</el-tag>
            <span v-if="draft" class="muted">
              编制：{{ draft.createdBy }} · {{ new Date(draft.createdAt).toLocaleString('zh-CN') }}
            </span>
            <span v-else class="muted">{{ clock?.clockNo }} · 零件 {{ parts.length }} 项 · 待办工序 {{ pendingStepCount }} 个</span>
          </div>
        </template>

        <el-alert v-if="error" :title="error" type="error" :closable="false" style="margin-bottom: 10px" />

        <div class="toolbar">
          <el-button size="small" type="primary" plain @click="prefill">按当前零件与待办工序生成明细</el-button>
          <el-button size="small" @click="addCustomRow">添加自定义明细</el-button>
          <span class="muted">师傅按当前零件和待办工序填写工时费、材料费</span>
        </div>

        <el-table :data="editorItems" size="small" border>
          <el-table-column label="类型" width="110">
            <template #default="{ row }">
              <el-select v-model="row.kind" size="small">
                <el-option v-for="k in ESTIMATE_ITEM_KINDS" :key="k.value" :label="k.label" :value="k.value" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="项目说明" min-width="220">
            <template #default="{ row }">
              <el-input v-model="row.label" size="small" placeholder="如 发条（换新）材料费" />
            </template>
          </el-table-column>
          <el-table-column label="来源" width="80">
            <template #default="{ row }">
              <el-tag v-if="row.source === 'part'" size="small" type="info" effect="plain">零件</el-tag>
              <el-tag v-else-if="row.source === 'step'" size="small" type="info" effect="plain">工序</el-tag>
              <el-tag v-else size="small" effect="plain">自定义</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="数量" width="130">
            <template #default="{ row }">
              <el-input-number v-model="row.qty" size="small" :min="0" :step="1" style="width: 110px" />
            </template>
          </el-table-column>
          <el-table-column label="单价 元" width="140">
            <template #default="{ row }">
              <el-input-number v-model="row.unitPrice" size="small" :min="0" :precision="2" :step="10" style="width: 120px" />
            </template>
          </el-table-column>
          <el-table-column label="金额" width="110">
            <template #default="{ row }">{{ formatMoney(row.qty * row.unitPrice) }}</template>
          </el-table-column>
          <el-table-column label="" width="70">
            <template #default="{ $index }">
              <el-button size="small" link type="danger" @click="removeRow($index)">删除</el-button>
            </template>
          </el-table-column>
          <template #empty>暂无明细，请生成或添加</template>
        </el-table>

        <div class="totals">
          <span>工时费 <strong>{{ formatMoney(editorTotals.labor) }}</strong></span>
          <span>材料费 <strong>{{ formatMoney(editorTotals.material) }}</strong></span>
          <span>合计 <strong class="total">{{ formatMoney(editorTotals.total) }}</strong></span>
          <el-tag v-if="editorDiff != null" :type="editorDiff === 0 ? 'info' : 'danger'" effect="dark">
            较已确认 v{{ status.confirmed?.version }} {{ formatDiff(editorDiff) }}
          </el-tag>
        </div>

        <el-form label-width="90px" style="margin-top: 12px">
          <el-form-item v-if="!draft" label="编制人" required>
            <el-input v-model="editorOperator" placeholder="师傅姓名" style="width: 220px" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="editorNote" type="textarea" :rows="2" placeholder="如 发条锈蚀严重改为换新，补差价" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveDraft">{{ draft ? '保存草稿' : '生成版本' }}</el-button>
            <el-button v-if="draft" type="success" :disabled="dirty" @click="openConfirm">前台确认</el-button>
            <el-button v-if="draft" type="danger" plain @click="discard">作废草稿</el-button>
            <span v-if="draft && dirty" class="muted">有未保存修改，确认前请先保存</span>
          </el-form-item>
        </el-form>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="card-head">
            <strong>版本历史</strong>
            <el-tag size="small" type="info">{{ versions.length }} 个版本</el-tag>
            <span class="muted">已确认版本冻结留存，原估价不再改动</span>
          </div>
        </template>
        <el-table :data="versions" size="small" border row-key="id">
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="expand">
                <el-table :data="row.items" size="small">
                  <el-table-column label="类型" width="90">
                    <template #default="{ row: item }">{{ item.kind === 'labor' ? '工时费' : '材料费' }}</template>
                  </el-table-column>
                  <el-table-column prop="label" label="项目说明" min-width="200" />
                  <el-table-column prop="qty" label="数量" width="80" />
                  <el-table-column label="单价" width="110">
                    <template #default="{ row: item }">{{ formatMoney(item.unitPrice) }}</template>
                  </el-table-column>
                  <el-table-column label="金额" width="110">
                    <template #default="{ row: item }">{{ formatMoney(item.amount) }}</template>
                  </el-table-column>
                </el-table>
                <div v-if="row.baseline" class="muted baseline">
                  确认基线：零件 {{ Object.keys(row.baseline.partDecisions).length }} 项 · 待办工序
                  {{ row.baseline.pendingStepCount }} 个 · 金额 {{ formatMoney(row.baseline.total) }}
                </div>
                <div v-if="row.note" class="muted">备注：{{ row.note }}</div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="版本" width="130">
            <template #default="{ row }">
              v{{ row.version }}
              <el-tag size="small" :type="STATE_TAG[row.state as Estimate['state']].type" style="margin-left: 6px">
                {{ STATE_TAG[row.state as Estimate['state']].label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="合计" width="120">
            <template #default="{ row }">{{ formatMoney(row.total) }}</template>
          </el-table-column>
          <el-table-column label="工时费" width="110">
            <template #default="{ row }">{{ formatMoney(row.laborTotal) }}</template>
          </el-table-column>
          <el-table-column label="材料费" width="110">
            <template #default="{ row }">{{ formatMoney(row.materialTotal) }}</template>
          </el-table-column>
          <el-table-column label="编制" min-width="180">
            <template #default="{ row }">{{ row.createdBy }} · {{ new Date(row.createdAt).toLocaleString('zh-CN') }}</template>
          </el-table-column>
          <el-table-column label="前台确认" min-width="180">
            <template #default="{ row }">
              <span v-if="row.confirmedBy">
                {{ row.confirmedBy }} · {{ row.confirmedAt ? new Date(row.confirmedAt).toLocaleString('zh-CN') : '' }}
              </span>
              <span v-else>—</span>
            </template>
          </el-table-column>
          <template #empty>暂无估价版本</template>
        </el-table>
      </el-card>
    </template>

    <el-empty v-if="!clockId" description="请先选择钟表" />

    <el-dialog v-model="confirmVisible" title="前台确认估价" width="460px">
      <el-alert v-if="confirmError" :title="confirmError" type="error" :closable="false" style="margin-bottom: 10px" />
      <template v-if="draft">
        <el-descriptions :column="1" border size="small" style="margin-bottom: 12px">
          <el-descriptions-item label="版本">v{{ draft.version }}</el-descriptions-item>
          <el-descriptions-item label="合计金额">{{ formatMoney(draft.total) }}</el-descriptions-item>
          <el-descriptions-item v-if="confirmDiff != null && status.confirmed" label="较已确认">
            v{{ status.confirmed.version }}（{{ formatMoney(status.confirmed.total) }}）→ 差额
            <strong>{{ formatDiff(confirmDiff) }}</strong>
          </el-descriptions-item>
          <el-descriptions-item v-else label="性质">首次确认</el-descriptions-item>
        </el-descriptions>
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          title="确认后该版本金额冻结；此后零件决定、工序数量或金额再变化，将标记为待补价。"
          style="margin-bottom: 12px"
        />
        <el-form label-width="90px">
          <el-form-item label="确认人" required>
            <el-input v-model="confirmer" placeholder="前台姓名" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="confirmVisible = false">取消</el-button>
        <el-button type="primary" @click="submitConfirm">确认估价</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.totals {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 12px;
  font-size: 14px;
}
.totals .total {
  font-size: 17px;
  color: #2f3a46;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.expand {
  padding: 4px 12px;
}
.baseline {
  margin-top: 8px;
}
</style>
