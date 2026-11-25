// App state, saved on the phone (localStorage) and mirrored to Firebase when signed in (see sync.js).
// entries: {id: {id, amount, cur, cat, date, note, rc: null|'pending'|'collected', batch, photo, created, updated}}
// batches: {id: {id, name, date, created}}   settings: {cur, curs, cats, budget, ocr, photos}
import { uid } from './util.js';

const KEY = 'budget.v1';

export const DEFAULT_CATS = [
  { id: 'groceries', name: 'Groceries', icon: '🛒', color: '#5fd4a8', budget: 0 },
  { id: 'eating', name: 'Eating out', icon: '🍜', color: '#f2994a', budget: 0 },
  { id: 'transport', name: 'Transport', icon: '🚃', color: '#56b4f0', budget: 0 },
  { id: 'home', name: 'Home', icon: '🏠', color: '#b59cf5', budget: 0 },
  { id: 'bills', name: 'Bills', icon: '💡', color: '#f2c94c', budget: 0 },
  { id: 'health', name: 'Health', icon: '💊', color: '#ef6b8a', budget: 0 },
  { id: 'clothes', name: 'Clothes', icon: '👕', color: '#4dd0e1', budget: 0 },
  { id: 'fun', name: 'Fun', icon: '🎮', color: '#ff8bd0', budget: 0 },
  { id: 'hobby', name: 'Cards & hobby', icon: '🃏', color: '#c4e05a', budget: 0 },
  { id: 'gifts', name: 'Gifts', icon: '🎁', color: '#ff7a6b', budget: 0 },
  { id: 'other', name: 'Other', icon: '📦', color: '#9aa0a6', budget: 0 },
];
export const DEFAULT_SETTINGS = { cur: 'JPY', curs: ['JPY', 'USD', 'EUR'], cats: DEFAULT_CATS, budget: 0, ocr: ['jpn', 'eng'], photos: true };
export const COLORS = ['#5fd4a8', '#f2994a', '#56b4f0', '#b59cf5', '#f2c94c', '#ef6b8a', '#4dd0e1', '#ff8bd0', '#c4e05a', '#ff7a6b', '#9aa0a6', '#7f9cf5'];

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { entries: s.entries || {}, batches: s.batches || {}, settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) } };
  } catch { return { entries: {}, batches: {}, settings: { ...DEFAULT_SETTINGS } }; }
}

let saveTimer = null;
export const store = {
  state: load(),
  remote: null, // set by sync.js while signed in
  listeners: new Set(),
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() {
    this.state = { ...this.state };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch {} }, 150);
    for (const fn of this.listeners) fn(this.state);
  },

  putEntry(e) {
    e = { ...e, updated: Date.now() };
    this.state.entries = { ...this.state.entries, [e.id]: e };
    this.emit();
    this.remote?.putEntries([e]);
    return e;
  },
  putEntries(list) {
    const entries = { ...this.state.entries };
    const out = list.map(e => (entries[e.id] = { ...e, updated: Date.now() }));
    this.state.entries = entries;
    this.emit();
    this.remote?.putEntries(out);
  },
  delEntry(id) {
    const entries = { ...this.state.entries };
    delete entries[id];
    this.state.entries = entries;
    this.emit();
    this.remote?.delEntry(id);
  },

  // Hand in receipts: put the chosen ones in a new batch.
  collect(ids, name, date) {
    const b = { id: uid(), name, date, created: Date.now() };
    this.state.batches = { ...this.state.batches, [b.id]: b };
    this.remote?.putBatch(b);
    this.putEntries(ids.map(id => ({ ...this.state.entries[id], rc: 'collected', batch: b.id })));
    return b;
  },
  putBatch(b) {
    this.state.batches = { ...this.state.batches, [b.id]: b };
    this.emit();
    this.remote?.putBatch(b);
  },
  // Undo a batch: its receipts go back to "to hand in".
  delBatch(id, back = true) {
    const batches = { ...this.state.batches };
    delete batches[id];
    this.state.batches = batches;
    const list = Object.values(this.state.entries).filter(e => e.batch === id)
      .map(e => ({ ...e, batch: null, rc: back ? 'pending' : 'collected' }));
    this.remote?.delBatch(id);
    if (list.length) this.putEntries(list); else this.emit();
  },

  setSettings(patch) {
    this.state.settings = { ...this.state.settings, ...patch };
    this.emit();
    this.remote?.putSettings(this.state.settings);
  },

  // From Firebase snapshots
  replace(kind, value) {
    this.state[kind] = kind === 'settings' ? { ...DEFAULT_SETTINGS, ...value } : value;
    this.emit();
  },
};

export const catOf = (settings, id) =>
  settings.cats.find(c => c.id === id) || { id, name: 'Uncategorized', icon: '❔', color: '#6b7177', budget: 0 };
