import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { round2, type Estimate, type EstimateSnapshot } from '../types/estimate';

interface EstimateState {
  items: Estimate[];
  loaded: boolean;
}

export const useEstimateStore = defineStore('estimate', {
  state: (): EstimateState => ({ items: [], loaded: false }),
  getters: {
    /** 某台钟表的全部估价版本，按版本号倒序 */
    byClock: (state) => (clockId: string) =>
      state.items.filter((it) => it.clockId === clockId).sort((a, b) => b.version - a.version),
    confirmedByClock: (state) => (clockId: string) =>
      state.items.find((it) => it.clockId === clockId && it.status === 'confirmed'),
  },
  actions: {
    async load() {
      const rows = await db.estimates.toArray();
      this.items = rows.sort((a, b) => b.createdAt - a.createdAt);
      this.loaded = true;
    },
    /** 师傅按当前零件与待办工序生成新估价版本（待前台确认） */
    async generate(payload: {
      clockId: string;
      laborFee: number;
      materialFee: number;
      snapshot: EstimateSnapshot;
      createdBy: string;
    }) {
      const existing = this.items.filter((it) => it.clockId === payload.clockId);
      const version = existing.length === 0 ? 1 : Math.max(...existing.map((it) => it.version)) + 1;
      const record: Estimate = {
        id: newId('est'),
        clockId: payload.clockId,
        version,
        laborFee: round2(payload.laborFee),
        materialFee: round2(payload.materialFee),
        total: round2(payload.laborFee + payload.materialFee),
        status: 'pending',
        snapshot: toPlain(payload.snapshot),
        createdBy: payload.createdBy,
        createdAt: Date.now(),
      };
      await db.estimates.put(toPlain(record));
      this.items = [record, ...this.items];
      return record;
    },
    /** 前台确认：该版本金额冻结，同钟表此前已确认的版本转为「已被取代」 */
    async confirm(id: string, confirmedBy: string) {
      const target = this.items.find((it) => it.id === id);
      if (!target || target.status !== 'pending') return;
      const now = Date.now();
      await db.transaction('rw', db.estimates, async () => {
        await db.estimates
          .where('clockId')
          .equals(target.clockId)
          .and((row) => row.status === 'confirmed')
          .modify({ status: 'stale' });
        await db.estimates.update(id, { status: 'confirmed', confirmedBy, confirmedAt: now });
      });
      this.items = this.items.map((it) => {
        if (it.id === id) return { ...it, status: 'confirmed', confirmedBy, confirmedAt: now };
        if (it.clockId === target.clockId && it.status === 'confirmed') return { ...it, status: 'stale' };
        return it;
      });
    },
  },
});
