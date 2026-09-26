import { computed, unref, type Ref } from 'vue';
import { useEstimateStore } from '../stores/estimateStore';
import { usePartStore } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { summarizeEstimate, type EstimateSummary } from '../types/estimate';

/**
 * 汇总某台钟表的估价状态：是否待补价、待确认差额、变化原因。
 * 被钟表详情页与工序录入页消费（用于阻止未确认差额前完成维修）。
 */
export function useEstimateStatus(clockId: string | Ref<string>) {
  const estimateStore = useEstimateStore();
  const partStore = usePartStore();
  const stepStore = useStepStore();
  const id = computed(() => unref(clockId));

  const summary = computed<EstimateSummary>(() => {
    const estimates = estimateStore.byClock(id.value);
    const parts = partStore.byClock(id.value);
    const stepCount = stepStore.items.filter((it) => it.clockId === id.value).length;
    return summarizeEstimate(estimates, parts, stepCount);
  });

  /** 存在待确认差额：补充金额确认前不能完成维修 */
  const hasPendingDiff = computed(() => summary.value.state === 'pending-diff');

  return { summary, hasPendingDiff };
}
