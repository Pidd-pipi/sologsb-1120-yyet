import { usePartStore } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { useEstimateStore } from '../stores/estimateStore';
import { estimateStatus } from '../utils/estimate';
import type { RepairState } from '../types/clock';

export const REPAIR_STATES: RepairState[] = ['未开工', '维修中', '待测试', '待补价', '已完成'];

/**
 * 由工序、走时测试与估价确认状态推导修复状态。
 * 补充金额未确认（待补价）时，即使工序与测试齐备也不能进入「已完成」。
 */
export function useRepairState() {
  const stepStore = useStepStore();
  const partStore = usePartStore();
  const estimateStore = useEstimateStore();

  function repairStateOf(clockId: string): RepairState {
    const steps = stepStore.items.filter((s) => s.clockId === clockId);
    const tests = stepStore.tests.filter((t) => t.clockId === clockId);
    const done = steps.filter((s) => s.state === 'done').length;
    let base: RepairState = '未开工';
    if (steps.length > 0 && done === steps.length && tests.length > 0) base = '已完成';
    else if (steps.length > 0 && done === steps.length) base = '待测试';
    else if (done > 0) base = '维修中';
    if (base === '已完成') {
      const status = estimateStatus(
        estimateStore.byClock(clockId),
        partStore.byClock(clockId),
        stepStore.byClock(clockId),
      );
      if (status.pending) return '待补价';
    }
    return base;
  }

  return { repairStateOf };
}
