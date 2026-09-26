import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { Estimate, EstimateBaseline, EstimateItem } from '../types/estimate';
import { normalizeItems, totalsOf } from '../utils/estimate';

interface EstimateStoreState {
  items: Estimate[];
  loaded: boolean;
}

export const useEstimateStore = defineStore('estimate', {
  state: (): EstimateStoreState => ({ items: [], loaded: false }),
  getters: {
    /** 某台钟表的全部估价版本，新 → 旧 */
    byClock: (state) => (clockId: string) =>
      state.items.filter((it) => it.clockId === clockId).sort((a, b) => b.version - a.version),
  },
  actions: {
    async load() {
      this.items = await db.estimates.toArray();
      this.loaded = true;
    },
    /** 生成新版本草稿（每台钟表版本号从 1 递增） */
    async createDraft(clockId: string, items: EstimateItem[], note: string, createdBy: string) {
      const versions = this.items.filter((it) => it.clockId === clockId).map((it) => it.version);
      const version = versions.length === 0 ? 1 : Math.max(...versions) + 1;
      const normalized = normalizeItems(items);
      const record: Estimate = {
        id: newId('est'),
        clockId,
        version,
        state: 'draft',
        items: toPlain(normalized),
        ...totalsOf(normalized),
        note,
        createdBy,
        createdAt: Date.now(),
      };
      await db.estimates.put(toPlain(record));
      this.items = [...this.items, record];
      return record;
    },
    /** 保存草稿修改（确认前的草稿可反复编辑） */
    async updateDraft(id: string, items: EstimateItem[], note: string) {
      const normalized = normalizeItems(items);
      const patch = { items: toPlain(normalized), ...totalsOf(normalized), note };
      await db.estimates.update(id, toPlain(patch));
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    },
    async discardDraft(id: string) {
      await db.estimates.delete(id);
      this.items = this.items.filter((it) => it.id !== id);
    },
    /**
     * 前台确认：冻结该版本内容与金额，留下基线快照；
     * 同台钟表上一份已确认版本转为「已被取代」，原估价保留可查。
     */
    async confirm(id: string, confirmedBy: string, baseline: EstimateBaseline) {
      const target = this.items.find((it) => it.id === id);
      if (!target) return;
      const confirmedAt = Date.now();
      const plainBaseline = toPlain(baseline);
      await db.transaction('rw', db.estimates, async () => {
        await db.estimates
          .where('clockId')
          .equals(target.clockId)
          .and((it) => it.state === 'confirmed')
          .modify({ state: 'superseded' });
        await db.estimates.update(id, { state: 'confirmed', confirmedBy, confirmedAt, baseline: plainBaseline });
      });
      this.items = this.items.map((it) => {
        if (it.id === id) return { ...it, state: 'confirmed' as const, confirmedBy, confirmedAt, baseline: plainBaseline };
        if (it.clockId === target.clockId && it.state === 'confirmed') return { ...it, state: 'superseded' as const };
        return it;
      });
    },
  },
});
