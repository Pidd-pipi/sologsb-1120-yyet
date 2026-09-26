import { useEstimateStore } from '../stores/estimateStore';
import { usePartStore } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { estimateStatus, estimateTagOf, type EstimateStatus, type EstimateTag } from '../utils/estimate';

/**
 * 汇总一台钟表的估价确认状态（待补价 / 待确认差额）。
 * 被钟表台账、详情页与估价单页共同消费。
 */
export function useEstimateStatus() {
  const estimateStore = useEstimateStore();
  const partStore = usePartStore();
  const stepStore = useStepStore();

  function statusOf(clockId: string): EstimateStatus {
    return estimateStatus(
      estimateStore.byClock(clockId),
      partStore.byClock(clockId),
      stepStore.byClock(clockId),
    );
  }

  function tagOf(clockId: string): EstimateTag | null {
    const versions = estimateStore.byClock(clockId);
    return estimateTagOf(statusOf(clockId), versions.length);
  }

  return { statusOf, tagOf };
}
