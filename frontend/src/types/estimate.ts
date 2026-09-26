import type { PartDecision } from './part';

/** 估价费用类型：工时费 / 材料费 */
export type EstimateItemKind = 'labor' | 'material';

export const ESTIMATE_ITEM_KINDS: { value: EstimateItemKind; label: string }[] = [
  { value: 'labor', label: '工时费' },
  { value: 'material', label: '材料费' },
];

/** 估价明细来源 */
export type EstimateItemSource = 'part' | 'step' | 'custom';

/** 估价单明细行 */
export interface EstimateItem {
  id: string;
  kind: EstimateItemKind;
  /** 项目说明，如「发条（换新）材料费」 */
  label: string;
  source: EstimateItemSource;
  /** 来源零件 / 工序 id（自定义行为空） */
  refId?: string;
  qty: number;
  /** 单价 元 */
  unitPrice: number;
  /** 金额 元 = qty × unitPrice */
  amount: number;
}

/** 估价单版本状态：草稿待确认 / 前台已确认 / 已被新版本取代 */
export type EstimateState = 'draft' | 'confirmed' | 'superseded';

/** 前台确认时留下的基线快照，用于事后比对「零件决定、工序数量、金额」是否再变化 */
export interface EstimateBaseline {
  /** 零件决定快照：partId → decision */
  partDecisions: Record<string, PartDecision>;
  /** 待办工序数量（state ≠ done） */
  pendingStepCount: number;
  /** 确认时的合计金额 */
  total: number;
}

/** 维修估价单（按版本留存，确认后内容不再改动） */
export interface Estimate {
  id: string;
  clockId: string;
  /** 版本号，每台钟表从 1 递增 */
  version: number;
  state: EstimateState;
  items: EstimateItem[];
  /** 工时费合计 */
  laborTotal: number;
  /** 材料费合计 */
  materialTotal: number;
  /** 合计金额 */
  total: number;
  note: string;
  /** 编制师傅 */
  createdBy: string;
  createdAt: number;
  /** 前台确认人 */
  confirmedBy?: string;
  confirmedAt?: number;
  /** 确认时基线（仅已确认版本有） */
  baseline?: EstimateBaseline;
}
