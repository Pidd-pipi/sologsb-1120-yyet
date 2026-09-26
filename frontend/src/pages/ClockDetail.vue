<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { usePartStore } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { useEstimateStore } from '../stores/estimateStore';
import { useRepairProgress } from '../hooks/useRepairProgress';
import { useEstimateStatus } from '../hooks/useEstimateStatus';
import StepSequence from '../components/common/StepSequence.vue';
import RateChart from '../components/common/RateChart.vue';
import StateBadge from '../components/common/StateBadge.vue';
import { CONDITION_GRADES, type ConditionGrade } from '../types/clock';
import { judgeTest } from '../types/test';
import {
  ESTIMATE_STATUS_LABELS,
  ESTIMATE_VIEW_LABELS,
  buildSnapshot,
  formatDiff,
  formatMoney,
  type EstimateStatus,
} from '../types/estimate';

function estimateStatusLabel(s: EstimateStatus): string {
  return ESTIMATE_STATUS_LABELS[s];
}

const route = useRoute();
const router = useRouter();
const clockStore = useClockStore();
const partStore = usePartStore();
const stepStore = useStepStore();
const estimateStore = useEstimateStore();

const clockId = computed(() => String(route.params.id ?? ''));
const clock = computed(() => clockStore.byId(clockId.value));
const { progress, steps, done, total, percent, current, gaps } = useRepairProgress(clockId);
const parts = computed(() => partStore.byClock(clockId.value));
const tests = computed(() => stepStore.testsByClock(clockId.value));
const estimates = computed(() => estimateStore.byClock(clockId.value));
const { summary: estimateSummary, hasPendingDiff } = useEstimateStatus(clockId);
const activeTab = ref('steps');

async function finish(id: string) {
  if (hasPendingDiff.value) {
    ElMessage.error('存在待确认差额，请前台确认补充金额后才能完成维修');
    return;
  }
  await stepStore.finish(id);
  ElMessage.success('步骤已完成');
}
async function rollback(id: string) {
  await stepStore.rollback(id);
  ElMessage.warning('步骤已回退');
}
async function move(payload: { id: string; direction: 'up' | 'down' }) {
  const list = steps.value;
  const index = list.findIndex((it) => it.id === payload.id);
  const target = payload.direction === 'up' ? list[index - 1] : list[index + 1];
  if (!target) return;
  await stepStore.swapSeq(payload.id, target.id);
  ElMessage.success('顺序已调整');
}
async function reorder(payload: { fromId: string; toId: string }) {
  await stepStore.swapSeq(payload.fromId, payload.toId);
  ElMessage.success('已按拖拽交换顺序');
}
async function changeGrade(value: unknown) {
  const grade = String(value) as ConditionGrade;
  await clockStore.setGrade(clockId.value, grade);
  ElMessage.success(`品相等级已更新为「${grade}」`);
}

/** 师傅填写的新估价版本表单 */
const estimateForm = reactive({
  laborFee: 0,
  materialFee: 0,
  createdBy: '',
});
const estimateError = ref('');

async function generateEstimate() {
  estimateError.value = '';
  if (!estimateForm.createdBy.trim()) {
    estimateError.value = '请填写填单师傅';
    return;
  }
  if (estimateForm.laborFee < 0 || estimateForm.materialFee < 0) {
    estimateError.value = '费用不能为负数';
    return;
  }
  const record = await estimateStore.generate({
    clockId: clockId.value,
    laborFee: estimateForm.laborFee,
    materialFee: estimateForm.materialFee,
    snapshot: buildSnapshot(parts.value, steps.value.length),
    createdBy: estimateForm.createdBy.trim(),
  });
  ElMessage.success(`已生成估价版本 v${record.version}，待前台确认`);
}

async function confirmEstimate(id: string) {
  try {
    const { value } = await ElMessageBox.prompt('请输入前台确认人姓名', '确认估价', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      inputPlaceholder: '如 前台-小周',
      inputValidator: (v: string) => (v && v.trim() ? true : '确认人必填'),
    });
    await estimateStore.confirm(id, String(value).trim());
    ElMessage.success('估价已确认，金额冻结');
  } catch {
    /* 用户取消 */
  }
}

onMounted(async () => {
  await clockStore.load();
  await partStore.load();
  await stepStore.load();
  await estimateStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>钟表详情 · {{ clock?.clockNo ?? '未找到' }}</h2>
      <StateBadge v-if="clock" :grade="clock.conditionGrade" />
      <el-tag v-if="hasPendingDiff" type="danger">
        待补价{{ estimateSummary.diff !== null ? ` ${formatDiff(estimateSummary.diff)}` : '（待重新估价）' }}
      </el-tag>
      <el-tag v-else-if="estimateSummary.state === 'unconfirmed'" type="warning">估价待确认</el-tag>
      <el-tag v-if="gaps.length" type="danger">顺序号缺口：{{ gaps.join('、') }}</el-tag>
      <el-tag v-else type="success" effect="plain">顺序号连续</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="router.push(`/steps/new?clockId=${clockId}`)">追加维修工序</el-button>
      <el-button @click="router.push(`/tests/${clockId}`)">走时测试录入</el-button>
      <el-button @click="router.push('/clocks')">返回台账</el-button>
    </div>

    <el-alert v-if="!clock" type="warning" :closable="false" title="未找到该钟表（可能已被删除）" show-icon />

    <div v-if="clock" class="grid">
      <el-card shadow="never">
        <template #header><strong>机芯信息</strong></template>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="藏品号">{{ clock.clockNo }}</el-descriptions-item>
          <el-descriptions-item label="种类">{{ clock.kind }}</el-descriptions-item>
          <el-descriptions-item label="机芯型号">{{ clock.caliber }}</el-descriptions-item>
          <el-descriptions-item label="国别 / 制作者">{{ clock.origin }} / {{ clock.maker }}</el-descriptions-item>
          <el-descriptions-item label="年代">{{ clock.yearMade }}</el-descriptions-item>
          <el-descriptions-item label="钟壳材质">{{ clock.caseMaterial }}</el-descriptions-item>
          <el-descriptions-item label="尺寸 mm">{{ clock.size }}</el-descriptions-item>
          <el-descriptions-item label="盘面标识">{{ clock.dialMark }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ clock.acquireFrom }}</el-descriptions-item>
          <el-descriptions-item label="存放位置">{{ clock.storagePos }}</el-descriptions-item>
          <el-descriptions-item label="零件条目">{{ parts.length }} 项</el-descriptions-item>
        </el-descriptions>
        <div class="grade-row">
          <span>品相等级：</span>
          <el-radio-group :model-value="clock.conditionGrade" size="small" @change="changeGrade">
            <el-radio-button v-for="g in CONDITION_GRADES" :key="g" :value="g">{{ g }}</el-radio-button>
          </el-radio-group>
        </div>
      </el-card>

      <div class="right">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>修复进度</strong>
              <el-tag size="small">{{ done }}/{{ total }} · {{ percent }}%</el-tag>
              <span v-if="current" class="muted">
                当前卡点：#{{ current.seq }} {{ current.stepType }}（{{ current.operator }}）
              </span>
              <span v-else class="muted">全部步骤已完成</span>
            </div>
          </template>
          <el-progress :percentage="percent" :stroke-width="12" />
          <el-tabs v-model="activeTab" style="margin-top: 12px">
            <el-tab-pane label="工序顺序" name="steps">
              <StepSequence
                :items="steps"
                sortable
                @finish="finish"
                @rollback="rollback"
                @move="move"
                @reorder="reorder"
              />
            </el-tab-pane>
            <el-tab-pane :label="`零件清单（${parts.length}）`" name="parts">
              <el-table :data="parts" size="small" border>
                <el-table-column prop="name" label="零件" width="110" />
                <el-table-column prop="position" label="装配位置" min-width="150" />
                <el-table-column prop="wearState" label="磨损" width="90" />
                <el-table-column prop="decision" label="处理" width="90" />
                <el-table-column prop="sourceLot" label="来源批号" width="120" />
                <el-table-column prop="dimension" label="尺寸 mm" width="100" />
              </el-table>
              <el-empty v-if="parts.length === 0" description="暂无零件登记" :image-size="60" />
            </el-tab-pane>
            <el-tab-pane :label="`走时测试（${tests.length}）`" name="tests">
              <div v-for="t in tests" :key="t.id" class="test-block">
                <div class="card-head">
                  <strong>{{ new Date(t.testedAt).toLocaleString('zh-CN') }}</strong>
                  <el-tag size="small" type="success">{{ t.conclusion || judgeTest(t.rate, t.beatError, t.amplitude) }}</el-tag>
                  <span class="muted">日差 {{ t.rate }} s/d · 摆幅 {{ t.amplitude }}° · 偏振 {{ t.beatError }} ms</span>
                </div>
                <RateChart :readings="t.positions" />
              </div>
              <el-empty v-if="tests.length === 0" description="暂无走时测试记录" :image-size="60" />
            </el-tab-pane>
            <el-tab-pane :label="`估价单（${estimates.length}）`" name="estimate">
              <div class="estimate-status">
                <el-tag
                  :type="
                    estimateSummary.state === 'pending-diff'
                      ? 'danger'
                      : estimateSummary.state === 'confirmed'
                        ? 'success'
                        : estimateSummary.state === 'unconfirmed'
                          ? 'warning'
                          : 'info'
                  "
                >
                  {{ ESTIMATE_VIEW_LABELS[estimateSummary.state] }}
                </el-tag>
                <span v-if="estimateSummary.confirmed">
                  已确认金额 <strong>{{ formatMoney(estimateSummary.confirmed.total) }}</strong>（v{{
                    estimateSummary.confirmed.version
                  }}
                  冻结）
                </span>
                <span v-if="estimateSummary.pending">
                  最新版本 v{{ estimateSummary.pending.version }}
                  <strong>{{ formatMoney(estimateSummary.pending.total) }}</strong>
                </span>
                <span v-if="estimateSummary.state === 'pending-diff'" class="diff">
                  待确认差额：
                  <strong>{{ estimateSummary.diff !== null ? formatDiff(estimateSummary.diff) : '待重新估价' }}</strong>
                </span>
              </div>
              <el-alert
                v-if="estimateSummary.state === 'pending-diff'"
                type="error"
                :closable="false"
                show-icon
                title="确认后的内容已变化，原估价保持不变，补充金额确认前不能完成维修"
                style="margin: 10px 0"
              >
                <ul class="reason-list">
                  <li v-for="(r, i) in estimateSummary.reasons" :key="i">{{ r }}</li>
                </ul>
              </el-alert>

              <el-card shadow="never" class="estimate-form">
                <template #header><strong>师傅填写新估价版本</strong></template>
                <el-alert
                  v-if="estimateError"
                  :title="estimateError"
                  type="error"
                  :closable="false"
                  style="margin-bottom: 10px"
                />
                <el-form :inline="true" @submit.prevent>
                  <el-form-item label="工时费 元">
                    <el-input-number v-model="estimateForm.laborFee" :min="0" :max="999999" :precision="2" />
                  </el-form-item>
                  <el-form-item label="材料费 元">
                    <el-input-number v-model="estimateForm.materialFee" :min="0" :max="999999" :precision="2" />
                  </el-form-item>
                  <el-form-item label="填单师傅">
                    <el-input v-model="estimateForm.createdBy" style="width: 140px" />
                  </el-form-item>
                  <el-form-item>
                    <el-button type="primary" @click="generateEstimate">生成估价版本</el-button>
                  </el-form-item>
                </el-form>
                <div class="muted">
                  将按当前 {{ parts.length }} 项零件决定与 {{ steps.length }} 道待办工序生成快照，前台确认后金额冻结。
                </div>
              </el-card>

              <el-table :data="estimates" size="small" border style="margin-top: 12px">
                <el-table-column label="版本" width="70">
                  <template #default="{ row }">v{{ row.version }}</template>
                </el-table-column>
                <el-table-column label="工时费" width="110">
                  <template #default="{ row }">{{ formatMoney(row.laborFee) }}</template>
                </el-table-column>
                <el-table-column label="材料费" width="110">
                  <template #default="{ row }">{{ formatMoney(row.materialFee) }}</template>
                </el-table-column>
                <el-table-column label="合计" width="120">
                  <template #default="{ row }">
                    <strong>{{ formatMoney(row.total) }}</strong>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="110">
                  <template #default="{ row }">
                    <el-tag
                      size="small"
                      :type="row.status === 'confirmed' ? 'success' : row.status === 'pending' ? 'warning' : 'info'"
                    >
                      {{ estimateStatusLabel(row.status) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="填单" min-width="170">
                  <template #default="{ row }">
                    {{ row.createdBy }} · {{ new Date(row.createdAt).toLocaleString('zh-CN') }}
                  </template>
                </el-table-column>
                <el-table-column label="前台确认" min-width="170">
                  <template #default="{ row }">
                    <span v-if="row.confirmedAt">
                      {{ row.confirmedBy }} · {{ new Date(row.confirmedAt).toLocaleString('zh-CN') }}
                    </span>
                    <span v-else>—</span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="120">
                  <template #default="{ row }">
                    <el-button
                      v-if="row.status === 'pending'"
                      size="small"
                      type="primary"
                      @click="confirmEstimate(row.id)"
                    >
                      前台确认
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
              <el-empty v-if="estimates.length === 0" description="暂无估价单，请师傅填写工时费与材料费" :image-size="60" />
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>
    </div>
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
.grid {
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.right {
  min-width: 0;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.grade-row {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.test-block {
  margin-bottom: 16px;
}
.estimate-status {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.estimate-status .diff {
  color: #d93025;
}
.reason-list {
  margin: 6px 0 0;
  padding-left: 18px;
}
.estimate-form {
  margin-top: 12px;
}
</style>
