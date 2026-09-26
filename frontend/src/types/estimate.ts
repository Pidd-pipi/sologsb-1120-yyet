import type { MovementPart, PartDecision } from './part';

/** 估价单状态：待前台确认 / 已确认（金额冻结）/ 被新版本取代 */
export type EstimateStatus = 'pending' | 'confirmed' | 'stale';

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  pending: '待前台确认',
  confirmed: '已确认',
  stale: '已被取代',
};

/** 生成估价版本时的实物快照，用于确认后检测零件决定 / 工序数量变化 */
export interface EstimateSnapshot {
  /** 待办工序数量 */
  stepCount: number;
  /** 各零件的处理决定 */
  partDecisions: { partId: string; name: string; decision: PartDecision }[];
}

/** 维修估价单（按版本管理，确认后金额冻结） */
export interface Estimate {
  id: string;
  clockId: string;
  /** 版本号，每台钟表从 1 递增 */
  version: number;
  /** 工时费 元 */
  laborFee: number;
  /** 材料费 元 */
  materialFee: number;
  /** 合计 = 工时费 + 材料费 */
  total: number;
  status: EstimateStatus;
  snapshot: EstimateSnapshot;
  /** 填单师傅 */
  createdBy: string;
  createdAt: number;
  /** 前台确认人 */
  confirmedBy?: string;
  confirmedAt?: number;
}

export type EstimateDraft = Omit<Estimate, 'id' | 'createdAt' | 'status'>;

/** 估价视图状态 */
export type EstimateViewState = 'none' | 'unconfirmed' | 'confirmed' | 'pending-diff';

export const ESTIMATE_VIEW_LABELS: Record<EstimateViewState, string> = {
  none: '未估价',
  unconfirmed: '估价待确认',
  confirmed: '估价已确认',
  'pending-diff': '待补价',
};

/** 单台钟表的估价汇总（台账与详情页共用） */
export interface EstimateSummary {
  state: EstimateViewState;
  /** 已确认版本（金额冻结，永不改动） */
  confirmed?: Estimate;
  /** 待确认的最新版本 */
  pending?: Estimate;
  /** 确认后发生的变化原因 */
  reasons: string[];
  /** 待确认差额（新版 - 已确认）；无法计算时为 null */
  diff: number | null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatMoney(n: number): string {
  return `¥${n.toFixed(2)}`;
}

/** 带符号差额，如 +¥200.00 / -¥50.00 */
export function formatDiff(n: number): string {
  return `${n >= 0 ? '+' : '-'}¥${Math.abs(n).toFixed(2)}`;
}

/** 以当前零件与工序生成快照 */
export function buildSnapshot(parts: MovementPart[], stepCount: number): EstimateSnapshot {
  return {
    stepCount,
    partDecisions: parts.map((p) => ({ partId: p.id, name: p.name, decision: p.decision })),
  };
}

/**
 * 对比已确认估价与当前实物，列出需要补价的原因：
 * 零件决定变化、工序数量变化，或新版本的金额与已确认金额不一致。
 */
export function diffReasons(
  confirmed: Estimate,
  parts: MovementPart[],
  stepCount: number,
  pending?: Estimate,
): string[] {
  const reasons: string[] = [];
  const snap = confirmed.snapshot;
  if (snap.stepCount !== stepCount) {
    reasons.push(`工序数量 ${snap.stepCount} → ${stepCount}`);
  }
  const snapMap = new Map(snap.partDecisions.map((d) => [d.partId, d]));
  const currentIds = new Set(parts.map((p) => p.id));
  for (const p of parts) {
    const s = snapMap.get(p.id);
    if (!s) {
      reasons.push(`新增零件「${p.name}」（${p.decision}）`);
    } else if (s.decision !== p.decision) {
      reasons.push(`零件「${p.name}」决定 ${s.decision} → ${p.decision}`);
    }
  }
  for (const d of snap.partDecisions) {
    if (!currentIds.has(d.partId)) {
      reasons.push(`零件「${d.name}」已移除`);
    }
  }
  if (pending && round2(pending.total) !== round2(confirmed.total)) {
    reasons.push(`估价金额 ${formatMoney(confirmed.total)} → ${formatMoney(pending.total)}`);
  }
  return reasons;
}

/**
 * 汇总一台钟表的估价状态。
 * 已确认版本金额保持不变；确认后实物或金额再变化时标为待补价（pending-diff）。
 */
export function summarizeEstimate(
  estimates: Estimate[],
  parts: MovementPart[],
  stepCount: number,
): EstimateSummary {
  const sorted = [...estimates].sort((a, b) => b.version - a.version);
  const confirmed = sorted.find((e) => e.status === 'confirmed');
  const latest = sorted[0];
  const pending = latest && latest.status === 'pending' ? latest : undefined;
  if (!confirmed) {
    return {
      state: sorted.length > 0 ? 'unconfirmed' : 'none',
      pending,
      reasons: [],
      diff: null,
    };
  }
  const reasons = diffReasons(confirmed, parts, stepCount, pending);
  if (reasons.length === 0) {
    return { state: 'confirmed', confirmed, pending, reasons, diff: 0 };
  }
  return {
    state: 'pending-diff',
    confirmed,
    pending,
    reasons,
    diff: pending ? round2(pending.total - confirmed.total) : null,
  };
}
