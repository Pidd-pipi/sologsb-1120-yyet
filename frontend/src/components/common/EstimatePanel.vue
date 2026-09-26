<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useEstimateStore } from '../../stores/estimateStore';
import { usePartStore } from '../../stores/partStore';
import { useStepStore } from '../../stores/stepStore';
import { estimateStatus, formatDiff, formatMoney } from '../../utils/estimate';

const props = defineProps<{ clockId: string }>();
const router = useRouter();
const estimateStore = useEstimateStore();
const partStore = usePartStore();
const stepStore = useStepStore();

const versions = computed(() => estimateStore.byClock(props.clockId));
const status = computed(() =>
  estimateStatus(versions.value, partStore.byClock(props.clockId), stepStore.byClock(props.clockId)),
);

function open() {
  void router.push(`/estimates/${props.clockId}`);
}
</script>

<template>
  <div class="estimate-panel">
    <el-alert
      v-if="status.pending"
      type="error"
      :closable="false"
      show-icon
      title="已确认估价待补价"
      :description="`${status.reasons.join('；')}。${
        status.diff != null ? `待确认差额 ${formatDiff(status.diff)}` : '差额待师傅填报补价版本'
      }；补充金额经前台确认前不能完成维修。`"
    />
    <el-alert
      v-else-if="status.draft"
      type="warning"
      :closable="false"
      show-icon
      :title="`估价草稿 v${status.draft.version} 待前台确认（合计 ${formatMoney(status.draft.total)}）`"
    />
    <el-alert
      v-else-if="status.confirmed"
      type="success"
      :closable="false"
      show-icon
      title="估价已确认，确认后零件决定、工序数量与金额均未再变化"
    />

    <el-descriptions v-if="status.confirmed" :column="2" border size="small">
      <el-descriptions-item label="生效版本">v{{ status.confirmed.version }}</el-descriptions-item>
      <el-descriptions-item label="合计金额">{{ formatMoney(status.confirmed.total) }}</el-descriptions-item>
      <el-descriptions-item label="工时费">{{ formatMoney(status.confirmed.laborTotal) }}</el-descriptions-item>
      <el-descriptions-item label="材料费">{{ formatMoney(status.confirmed.materialTotal) }}</el-descriptions-item>
      <el-descriptions-item label="确认人">{{ status.confirmed.confirmedBy ?? '—' }}</el-descriptions-item>
      <el-descriptions-item label="确认时间">
        {{ status.confirmed.confirmedAt ? new Date(status.confirmed.confirmedAt).toLocaleString('zh-CN') : '—' }}
      </el-descriptions-item>
    </el-descriptions>

    <el-empty v-if="versions.length === 0" description="尚未编制估价单" :image-size="60" />

    <div class="actions">
      <el-button type="primary" @click="open">{{ versions.length === 0 ? '编制估价单' : '打开估价单' }}</el-button>
      <span v-if="status.pending && status.diff != null" class="diff">待确认差额 {{ formatDiff(status.diff) }}</span>
    </div>
  </div>
</template>

<style scoped>
.estimate-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.diff {
  color: #c45656;
  font-weight: 700;
}
</style>
