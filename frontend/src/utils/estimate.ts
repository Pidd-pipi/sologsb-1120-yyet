import { newId } from './id';
import type { MovementPart } from '../types/part';
import type { RepairStep } from '../types/step';
import type { Estimate, EstimateBaseline, EstimateItem } from '../types/estimate';

/** 保留两位小数 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 金额显示 */
export function formatMoney(n: number): string {
  return `¥${round2(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 差额显示（带正负号） */
export function formatDiff(n: number): string {
  if (n > 0) return `+${formatMoney(n)}`;
  if (n < 0) return `-${formatMoney(-n)}`;
  return formatMoney(0);
}

/** 重算明细金额（qty × unitPrice） */
export function normalizeItems(items: EstimateItem[]): EstimateItem[] {
  return items.map((it) => ({ ...it, amount: round2(it.qty * it.unitPrice) }));
}

/** 工时费 / 材料费 / 合计 */
export function totalsOf(items: EstimateItem[]): { laborTotal: number; materialTotal: number; total: number } {
  const norm = normalizeItems(items);
  const laborTotal = round2(norm.filter((it) => it.kind === 'labor').reduce((sum, it) => sum + it.amount, 0));
  const materialTotal = round2(norm.filter((it) => it.kind === 'material').reduce((sum, it) => sum + it.amount, 0));
  return { laborTotal, materialTotal, total: round2(laborTotal + materialTotal) };
}

/** 按当前零件（处理决定非「保留」）与待办工序预填明细，师傅再填单价 */
export function buildPrefillItems(parts: MovementPart[], steps: RepairStep[]): EstimateItem[] {
  const items: EstimateItem[] = [];
  parts
    .filter((p) => p.decision !== '保留')
    .forEach((p) => {
      items.push({
        id: newId('itm'),
        kind: 'material',
        label: `${p.name}（${p.decision}）材料费`,
        source: 'part',
        refId: p.id,
        qty: p.qtyNeeded,
        unitPrice: 0,
        amount: 0,
      });
    });
  steps
    .filter((s) => s.state !== 'done')
    .sort((a, b) => a.seq - b.seq)
    .forEach((s) => {
      items.push({
        id: newId('itm'),
        kind: 'labor',
        label: `#${s.seq} ${s.stepType} 工时`,
        source: 'step',
        refId: s.id,
        qty: 1,
        unitPrice: 0,
        amount: 0,
      });
    });
  return items;
}

/** 确认时生成基线快照 */
export function buildBaseline(parts: MovementPart[], steps: RepairStep[], total: number): EstimateBaseline {
  const partDecisions: EstimateBaseline['partDecisions'] = {};
  parts.forEach((p) => {
    partDecisions[p.id] = p.decision;
  });
  return {
    partDecisions,
    pendingStepCount: steps.filter((s) => s.state !== 'done').length,
    total: round2(total),
  };
}

/** 比对基线与当前数据，返回变化原因（空数组 = 无变化） */
export function baselineReasons(baseline: EstimateBaseline, parts: MovementPart[], steps: RepairStep[]): string[] {
  const reasons: string[] = [];
  const current: Record<string, string> = {};
  parts.forEach((p) => {
    current[p.id] = p.decision;
  });
  const keys = new Set([...Object.keys(baseline.partDecisions), ...Object.keys(current)]);
  let partChanged = false;
  keys.forEach((k) => {
    if (baseline.partDecisions[k] !== current[k]) partChanged = true;
  });
  if (partChanged) reasons.push('零件决定已变化');
  const pendingStepCount = steps.filter((s) => s.state !== 'done').length;
  if (pendingStepCount !== baseline.pendingStepCount) reasons.push('待办工序数量已变化');
  return reasons;
}

/** 一台钟表的估价确认状态（由版本、零件、工序实时推导） */
export interface EstimateStatus {
  /** 当前生效的已确认版本 */
  confirmed?: Estimate;
  /** 待前台确认的草稿（补价或首版） */
  draft?: Estimate;
  /** 是否存在待确认差额（确认后数据再变化 → 待补价） */
  pending: boolean;
  /** 触发待补价的原因 */
  reasons: string[];
  /** 待确认差额 = 草稿合计 − 已确认合计；无草稿时为 null（差额待填报） */
  diff: number | null;
}

export function estimateStatus(versions: Estimate[], parts: MovementPart[], steps: RepairStep[]): EstimateStatus {
  const confirmed = versions.filter((v) => v.state === 'confirmed').sort((a, b) => b.version - a.version)[0];
  const draft = versions.filter((v) => v.state === 'draft').sort((a, b) => b.version - a.version)[0];
  if (!confirmed) return { confirmed, draft, pending: false, reasons: [], diff: null };
  const reasons = confirmed.baseline ? baselineReasons(confirmed.baseline, parts, steps) : [];
  if (draft && round2(draft.total) !== round2(confirmed.total)) reasons.push('估价金额已变化');
  const pending = reasons.length > 0;
  return {
    confirmed,
    draft,
    pending,
    reasons,
    diff: pending && draft ? round2(draft.total - confirmed.total) : null,
  };
}

/** 台账卡片 / 详情页角标 */
export interface EstimateTag {
  label: string;
  type: 'success' | 'warning' | 'danger' | 'info';
}

export function estimateTagOf(status: EstimateStatus, versionCount: number): EstimateTag | null {
  if (status.pending) {
    return {
      label: status.diff != null ? `待补价 ${formatDiff(status.diff)}` : '待补价 · 差额待填报',
      type: 'danger',
    };
  }
  if (status.confirmed && status.draft) return { label: `v${status.draft.version} 草稿待确认`, type: 'warning' };
  if (status.confirmed) return { label: `估价已确认 ${formatMoney(status.confirmed.total)}`, type: 'success' };
  if (status.draft) return { label: `估价草稿待确认 ${formatMoney(status.draft.total)}`, type: 'warning' };
  if (versionCount === 0) return { label: '未编制估价单', type: 'info' };
  return null;
}
