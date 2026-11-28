import { html, render, useState, useEffect, useMemo, useRef } from '../vendor/ui.mjs';
import { store, catOf, COLORS } from './store.js';
import { sync, initSync, signIn, signOutUser } from './sync.js';
import { photos } from './photos.js';
import { getRates, onRates, convert } from './fx.js';
import { prepare, recognize, warmUp } from './ocr.js';
import {
  uid, today, monthOf, monthLabel, shiftMonth, dayLabel, shortDate, parseISO,
  CURRENCIES, CUR, money, moneyMix, sumByCur, roundAmount,
} from './util.js';

const VERSION = '1.0.1';
const TABS = ['home', 'receipts', 'settings'];

// ---------- hooks ----------
function useStore() {
  const [s, set] = useState(store.state);
  useEffect(() => store.on(set), []);
  return s;
}
function useSync() {
  const [, f] = useState(0);
  useEffect(() => sync.on(() => f(x => x + 1)), []);
  return sync;
}
function useRates(base) {
  const [fx, setFx] = useState(() => getRates(base));
  useEffect(() => { setFx(getRates(base)); return onRates(r => r.base === base && setFx(r)); }, [base]);
  return fx;
}
function useRoute() {
  const get = () => decodeURIComponent(location.hash.slice(1)) || 'home';
  const [r, set] = useState(get);
  useEffect(() => {
    const f = () => set(get());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return r;
}

// Overlays (add/edit) push a history entry so the phone's back button closes them.
let pushedOverlay = false;
const openOverlay = h => { pushedOverlay = true; location.hash = h; };
function closeOverlay(tab) {
  if (pushedOverlay) { pushedOverlay = false; history.back(); }
  else location.replace('#' + tab);
}

// ---------- toast ----------
let toastSet = null;
export function toast(msg, action) {
  toastSet?.({ msg, action, id: Date.now() });
}
function Toast() {
  const [t, set] = useState(null);
  useEffect(() => { toastSet = set; }, []);
  useEffect(() => { if (t) { const id = setTimeout(() => set(null), t.action ? 6000 : 2600); return () => clearTimeout(id); } }, [t]);
  if (!t) return null;
  return html`<div class="toast" key=${t.id}>
    <span>${t.msg}</span>
    ${t.action && html`<button class="link" onClick=${() => { t.action.fn(); set(null); }}>${t.action.label}</button>`}
  </div>`;
}

// ---------- small pieces ----------
function Modal({ title, onClose, children }) {
  return html`<div class="modal-bg" onClick=${e => e.target === e.currentTarget && onClose()}>
    <div class="modal">
      <div class="modal-head"><h3>${title}</h3><button class="icon-btn" aria-label="Close" onClick=${onClose}>✕</button></div>
      ${children}
    </div>
  </div>`;
}

function Confirm({ label, confirmLabel = 'Tap again to confirm', onConfirm, cls = 'btn danger ghost' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (armed) { const id = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(id); } }, [armed]);
  return html`<button class=${cls + (armed ? ' armed' : '')} onClick=${() => (armed ? onConfirm() : setArmed(true))}>${armed ? confirmLabel : label}</button>`;
}

function SyncDot() {
  const s = useSync();
  const cls = { synced: 'ok', syncing: 'busy', error: 'err' }[s.status] || 'off';
  const title = { synced: 'Synced', syncing: 'Syncing…', error: 'Sync error', signedout: 'Not signed in', starting: 'Starting…', off: 'Sync off' }[s.status];
  return html`<a class=${'sync-dot ' + cls} href="#settings" title=${title} aria-label=${title}></a>`;
}

function ReceiptBadge({ e }) {
  if (!e.rc) return null;
  return e.rc === 'pending'
    ? html`<span class="badge pending" title="Receipt to hand in">🧾</span>`
    : html`<span class="badge done" title="Receipt handed in">✓</span>`;
}

function EntryRow({ e, settings, onClick, right }) {
  const c = catOf(settings, e.cat);
  return html`<button class="entry" onClick=${onClick}>
    <span class="cat-ico" style=${{ background: c.color + '22', color: c.color }}>${c.icon}</span>
    <span class="entry-main">
      <span class="entry-title">${e.note || c.name}</span>
      <span class="entry-sub">${e.note ? c.name : ''}${right ? (e.note ? ' · ' : '') + shortDate(e.date) : ''}</span>
    </span>
    <${ReceiptBadge} e=${e} />
    <span class="amt">${money(e.amount, e.cur)}</span>
  </button>`;
}

// ---------- Home ----------
function Home({ s, month, setMonth, onEdit }) {
  const { settings } = s;
  const base = settings.cur;
  const fx = useRates(base);
  const [filter, setFilter] = useState(null);

  const list = useMemo(() => Object.values(s.entries)
    .filter(e => monthOf(e.date) === month)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0)), [s.entries, month]);

  const stats = useMemo(() => {
    let total = 0;
    const byCat = {}, unconverted = [], converted = [];
    for (const e of list) {
      const v = convert(e.amount, e.cur, base, fx);
      if (v === null) { unconverted.push(e); continue; }
      if (e.cur !== base) converted.push(e);
      total += v;
      byCat[e.cat] = (byCat[e.cat] || 0) + v;
    }
    const cats = Object.entries(byCat).map(([id, v]) => ({ c: catOf(settings, id), v })).sort((a, b) => b.v - a.v);
    return { total, cats, unconverted: sumByCur(unconverted), other: sumByCur(converted) };
  }, [list, fx, base, settings]);

  const pending = useMemo(() => Object.values(s.entries).filter(e => e.rc === 'pending'), [s.entries]);
  const shown = filter ? list.filter(e => e.cat === filter) : list;
  const groups = [];
  for (const e of shown) {
    const g = groups[groups.length - 1];
    if (g && g.date === e.date) g.items.push(e); else groups.push({ date: e.date, items: [e] });
  }

  const thisMonth = month === monthOf(today());
  const budget = settings.budget || 0;
  const daysLeft = thisMonth ? new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate() - new Date().getDate() + 1 : 0;
  const maxCat = Math.max(1, ...stats.cats.map(x => x.v));

  return html`<div class="page">
    <header class="top">
      <button class="icon-btn" aria-label="Previous month" onClick=${() => setMonth(shiftMonth(month, -1))}>‹</button>
      <h1 onClick=${() => setMonth(monthOf(today()))}>${monthLabel(month)}</h1>
      <button class="icon-btn" aria-label="Next month" onClick=${() => setMonth(shiftMonth(month, 1))}>›</button>
      <${SyncDot} />
    </header>

    <section class="hero">
      <div class="hero-label">Spent</div>
      <div class="hero-total">${money(stats.total, base, { round: true })}</div>
      ${Object.keys(stats.other).length > 0 && html`<div class="hero-sub">incl. ${moneyMix(stats.other)} converted to ${base}</div>`}
      ${Object.keys(stats.unconverted).length > 0 && html`<div class="hero-sub">+ ${moneyMix(stats.unconverted)} (converts when online)</div>`}
      ${budget > 0 && html`
        <div class="bar big"><i style=${{ width: Math.min(100, (stats.total / budget) * 100) + '%' }} class=${stats.total > budget ? 'over' : ''}></i></div>
        <div class="hero-sub">${stats.total > budget
          ? html`<b class="neg">${money(stats.total - budget, base, { round: true })} over</b> the ${money(budget, base, { round: true })} budget`
          : html`<b>${money(budget - stats.total, base, { round: true })} left</b> of ${money(budget, base, { round: true })}${thisMonth ? ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} to go` : ''}`}</div>`}
    </section>

    ${pending.length > 0 && html`<a class="pending-chip" href="#receipts">
      <span>🧾 <b>${pending.length}</b> receipt${pending.length === 1 ? '' : 's'} to hand in</span>
      <span class="amt">${moneyMix(sumByCur(pending))}</span>
    </a>`}

    ${stats.cats.length > 0 && html`<section class="card">
      ${stats.cats.map(({ c, v }) => html`<button class=${'cat-row' + (filter === c.id ? ' on' : '') + (filter && filter !== c.id ? ' dim' : '')} onClick=${() => setFilter(filter === c.id ? null : c.id)}>
        <span class="cat-ico sm" style=${{ background: c.color + '22', color: c.color }}>${c.icon}</span>
        <span class="cat-name">${c.name}</span>
        <span class="amt">${money(v, base, { round: true })}${c.budget > 0 ? html`<small> / ${money(c.budget, base, { round: true })}</small>` : ''}</span>
        <span class="bar"><i style=${{ width: Math.min(100, (v / (c.budget > 0 ? c.budget : maxCat)) * 100) + '%', background: c.budget > 0 && v > c.budget ? 'var(--neg)' : c.color }}></i></span>
      </button>`)}
    </section>`}

    ${filter && html`<div class="filter-note">Showing ${catOf(settings, filter).name} only · <button class="link" onClick=${() => setFilter(null)}>show all</button></div>`}

    ${groups.length === 0 && html`<div class="empty">
      <div class="empty-ico">🪙</div>
      <p>No spending in ${monthLabel(month).split(' ')[0]}${filter ? ' for this category' : ''} yet.</p>
      <p class="muted">Tap <b>＋ Add</b> to type an amount, or <b>📷 Scan</b> to read a receipt.</p>
    </div>`}

    ${groups.map(g => html`<section class="day">
      <div class="day-head"><span>${dayLabel(g.date)}</span><span>${moneyMix(sumByCur(g.items))}</span></div>
      ${g.items.map(e => html`<${EntryRow} key=${e.id} e=${e} settings=${settings} onClick=${() => onEdit(e.id)} />`)}
    </section>`)}
  </div>`;
}

// ---------- Receipts ----------
function Receipts({ s, onEdit }) {
  const { settings } = s;
  const [view, setView] = useState('pending');
  const [sel, setSel] = useState(() => new Set());
  const [handIn, setHandIn] = useState(false);
  const [open, setOpen] = useState(null);
  const [rename, setRename] = useState(null);

  const pending = useMemo(() => Object.values(s.entries).filter(e => e.rc === 'pending')
    .sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0)), [s.entries]);
  const collected = useMemo(() => Object.values(s.entries).filter(e => e.rc === 'collected'), [s.entries]);

  // drop selections of receipts that are no longer pending
  useEffect(() => {
    const ids = new Set(pending.map(e => e.id));
    if ([...sel].some(id => !ids.has(id))) setSel(new Set([...sel].filter(id => ids.has(id))));
  }, [pending]);

  const months = [];
  for (const e of pending) {
    const m = monthOf(e.date), g = months[months.length - 1];
    if (g && g.m === m) g.items.push(e); else months.push({ m, items: [e] });
  }
  const toggle = ids => {
    const n = new Set(sel);
    const all = ids.every(id => n.has(id));
    for (const id of ids) all ? n.delete(id) : n.add(id);
    setSel(n);
  };
  const selected = pending.filter(e => sel.has(e.id));

  const batches = Object.values(s.batches).sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created)
    .map(b => ({ ...b, items: collected.filter(e => e.batch === b.id).sort((x, y) => y.date.localeCompare(x.date) || (y.created || 0) - (x.created || 0)) }));
  const loose = collected.filter(e => !e.batch || !s.batches[e.batch]).sort((x, y) => y.date.localeCompare(x.date) || (y.created || 0) - (x.created || 0));
  if (loose.length) batches.push({ id: '_loose', name: 'Handed in earlier', date: null, items: loose });

  return html`<div class="page">
    <header class="top"><h1>Receipts</h1><${SyncDot} /></header>
    <div class="seg">
      <button class=${view === 'pending' ? 'on' : ''} onClick=${() => setView('pending')}>To hand in <b>${pending.length}</b></button>
      <button class=${view === 'done' ? 'on' : ''} onClick=${() => setView('done')}>Handed in <b>${collected.length}</b></button>
    </div>

    ${view === 'pending' && html`
      ${pending.length === 0 && html`<div class="empty"><div class="empty-ico">🧾</div>
        <p>No receipts waiting.</p>
        <p class="muted">Paper receipts you scan or mark as "To hand in" wait here until they're collected. Then select them and tap <b>Hand in</b>.</p></div>`}
      ${pending.length > 0 && html`<div class="row-between pad">
        <span class="muted">${moneyMix(sumByCur(pending))} in total</span>
        <button class="link" onClick=${() => toggle(pending.map(e => e.id))}>${selected.length === pending.length ? 'Select none' : 'Select all'}</button>
      </div>`}
      ${months.map(g => {
        const ids = g.items.map(e => e.id), all = ids.every(id => sel.has(id));
        return html`<section class="day">
          <label class="day-head check">
            <input type="checkbox" checked=${all} onChange=${() => toggle(ids)} />
            <span>${monthLabel(g.m)}</span><span>${moneyMix(sumByCur(g.items))}</span>
          </label>
          ${g.items.map(e => html`<div class="sel-row" key=${e.id}>
            <input type="checkbox" aria-label="Select" checked=${sel.has(e.id)} onChange=${() => toggle([e.id])} />
            <${EntryRow} e=${e} settings=${settings} right onClick=${() => onEdit(e.id)} />
          </div>`)}
        </section>`;
      })}
      ${selected.length > 0 && html`<div class="action-bar">
        <span><b>${selected.length}</b> selected · ${moneyMix(sumByCur(selected))}</span>
        <button class="btn primary" onClick=${() => setHandIn(true)}>Hand in</button>
      </div>`}
    `}

    ${view === 'done' && html`
      ${batches.length === 0 && html`<div class="empty"><div class="empty-ico">📦</div>
        <p>Nothing handed in yet.</p>
        <p class="muted">Each time receipts are collected they're kept here as one batch, with the date and total.</p></div>`}
      ${batches.map(b => html`<section class="card batch" key=${b.id}>
        <button class="batch-head" onClick=${() => setOpen(open === b.id ? null : b.id)}>
          <span><b>${b.name}</b><small>${b.date ? shortDate(b.date) + ' · ' : ''}${b.items.length} receipt${b.items.length === 1 ? '' : 's'}</small></span>
          <span class="amt">${moneyMix(sumByCur(b.items))}</span>
          <span class=${'chev' + (open === b.id ? ' up' : '')}>›</span>
        </button>
        ${open === b.id && html`<div class="batch-body">
          ${b.items.map(e => html`<${EntryRow} key=${e.id} e=${e} settings=${settings} right onClick=${() => onEdit(e.id)} />`)}
          ${b.id !== '_loose' && html`<div class="row-gap">
            <button class="btn ghost" onClick=${() => setRename(b)}>Rename</button>
            <${Confirm} label="Undo hand-in" confirmLabel="Move back to 'To hand in'?" onConfirm=${() => { store.delBatch(b.id); setOpen(null); toast('Receipts moved back to "To hand in"'); }} />
          </div>`}
        </div>`}
      </section>`)}
    `}

    ${handIn && html`<${HandIn} items=${selected} onClose=${() => setHandIn(false)} onDone=${b => {
      setHandIn(false); setSel(new Set()); setView('done'); setOpen(b.id);
      toast(`Handed in ${selected.length} receipt${selected.length === 1 ? '' : 's'}`, { label: 'Undo', fn: () => store.delBatch(b.id) });
    }} />`}
    ${rename && html`<${Modal} title="Rename batch" onClose=${() => setRename(null)}>
      <${BatchForm} batch=${rename} onSave=${(name, date) => { store.putBatch({ ...rename, name, date }); setRename(null); }} />
    </${Modal}>`}
  </div>`;
}

function BatchForm({ batch, onSave, cta = 'Save', summary }) {
  const [name, setName] = useState(batch.name);
  const [date, setDate] = useState(batch.date || today());
  return html`<form class="form" onSubmit=${e => { e.preventDefault(); onSave(name.trim() || 'Batch', date); }}>
    ${summary}
    <label>Name<input value=${name} onInput=${e => setName(e.target.value)} placeholder="e.g. Work, Nov" /></label>
    <label>Date collected<input type="date" value=${date} onInput=${e => setDate(e.target.value)} /></label>
    <button class="btn primary wide" type="submit">${cta}</button>
  </form>`;
}

function HandIn({ items, onClose, onDone }) {
  const d = today();
  return html`<${Modal} title="Hand in receipts" onClose=${onClose}>
    <${BatchForm} batch=${{ name: 'Collected ' + shortDate(d), date: d }} cta=${`Hand in ${items.length}`}
      summary=${html`<p class="muted">${items.length} receipt${items.length === 1 ? '' : 's'} · ${moneyMix(sumByCur(items))}. They'll be kept together as one batch.</p>`}
      onSave=${(name, date) => onDone(store.collect(items.map(e => e.id), name, date))} />
  </${Modal}>`;
}

// ---------- Add / edit ----------
const OCR_STEP = {
  'loading tesseract core': 'Loading the reader',
  'loading language traineddata': 'Loading language data',
  'loading language traineddata (from cache)': 'Loading language data',
  'initializing api': 'Starting the reader',
  'initializing tesseract': 'Starting the reader',
  'recognizing text': 'Reading the receipt',
};

function Editor({ route, file, s, onDone }) {
  const { settings } = s;
  const editId = route.startsWith('edit/') ? route.slice(5) : null;
  const existing = editId ? s.entries[editId] : null;
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [cur, setCur] = useState(existing?.cur || settings.cur);
  const [cat, setCat] = useState(existing?.cat || null);
  const [date, setDate] = useState(existing?.date || today());
  const [note, setNote] = useState(existing?.note || '');
  const [rc, setRc] = useState(existing?.rc || null);
  const [batch, setBatch] = useState(existing?.batch || '');
  const [photo, setPhoto] = useState(null); // Blob
  const [photoUrl, setPhotoUrl] = useState(null);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [scan, setScan] = useState(null); // {status, step, progress, parsed, error}
  const [viewer, setViewer] = useState(false);
  const [showText, setShowText] = useState(false);
  const [tried, setTried] = useState(false);
  const run = useRef(0);
  const lastFile = useRef(null);
  const rotation = useRef(0);
  const touched = useRef(!!existing);
  const camRef = useRef(), galRef = useRef(), amountRef = useRef();

  useEffect(() => {
    if (file) startScan(file);
    else if (!existing && route !== 'add/scan') setTimeout(() => amountRef.current?.focus(), 60);
    if (existing?.photo) photos.get(existing.id).then(b => b && !photoChanged && setPhoto(b));
  }, []);
  useEffect(() => {
    if (!photo) { setPhotoUrl(null); return; }
    const u = URL.createObjectURL(photo);
    setPhotoUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  if (editId && !existing) return html`<div class="editor"><header class="top"><button class="icon-btn" onClick=${onDone}>✕</button><h1>Not found</h1></header></div>`;

  async function startScan(f, rot = 0) {
    const my = ++run.current;
    lastFile.current = f; rotation.current = rot;
    setScan({ status: 'prep', step: 'Preparing photo' });
    if (!rc) setRc('pending');
    try {
      const { canvas, photo: p } = await prepare(f, rot);
      if (my !== run.current) return;
      setPhoto(p); setPhotoChanged(true);
      setScan({ status: 'reading', step: 'Loading the reader', progress: 0 });
      const r = await recognize(canvas, {
        langs: settings.ocr?.length ? settings.ocr : ['jpn', 'eng'],
        onProgress: m => my === run.current && setScan(x => ({ ...x, step: OCR_STEP[m.status] || x?.step, progress: m.progress })),
      });
      if (my !== run.current) return;
      if (r.cur && CUR[r.cur]) setCur(r.cur);
      if (r.total && !touched.current) setAmount(String(r.total));
      if (r.date) setDate(r.date);
      setScan({ status: 'done', parsed: r });
    } catch (e) {
      console.error(e);
      if (my === run.current) setScan({ status: 'error', error: e.message || String(e) });
    }
  }
  const pick = ref => { ref.current.value = ''; ref.current.click(); };
  const onPick = e => { const f = e.target.files[0]; if (f) { touched.current = false; startScan(f); } };

  const num = parseFloat(String(amount).replace(/[^\d.,]/g, '').replace(',', '.'));
  const valid = num > 0 && cat;
  function save() {
    setTried(true);
    if (!valid) return;
    const e = {
      id: existing?.id || uid(), amount: roundAmount(num, cur), cur, cat, date, note: note.trim(),
      rc: rc || null, batch: rc === 'collected' ? batch || null : null, photo: !!photo,
      created: existing?.created || Date.now(),
    };
    store.putEntry(e);
    if (photoChanged) photo ? photos.put(e.id, photo) : photos.del(e.id);
    toast(existing ? 'Saved' : `Added ${money(e.amount, cur)} · ${catOf(settings, cat).name}`);
    onDone();
  }
  const curOptions = [...new Set([...settings.curs, settings.cur, cur])];
  const batches = Object.values(s.batches).sort((a, b) => b.date.localeCompare(a.date));
  const busy = scan && (scan.status === 'prep' || scan.status === 'reading');

  return html`<div class="editor">
    <header class="top">
      <button class="icon-btn" aria-label="Close" onClick=${onDone}>✕</button>
      <h1>${existing ? 'Edit' : 'Add expense'}</h1>
      <span class="spacer"></span>
    </header>
    <input type="file" accept="image/*" capture="environment" ref=${camRef} onChange=${onPick} hidden />
    <input type="file" accept="image/*" ref=${galRef} onChange=${onPick} hidden />

    <div class="amount-box">
      <select class="cur-select" value=${cur} onChange=${e => setCur(e.target.value)} aria-label="Currency">
        ${curOptions.map(c => html`<option value=${c}>${c} ${CUR[c]?.[1] || ''}</option>`)}
        <option disabled>──────</option>
        ${CURRENCIES.filter(c => !curOptions.includes(c[0])).map(c => html`<option value=${c[0]}>${c[0]} ${c[1]} · ${c[2]}</option>`)}
      </select>
      <input ref=${amountRef} class="amount-input" inputmode="decimal" placeholder="0" value=${amount}
        onInput=${e => { touched.current = true; setAmount(e.target.value); }} aria-label="Amount" />
    </div>

    ${scan && html`<div class=${'scan-box ' + scan.status}>
      ${busy && html`<div class="scan-status"><span class="spin"></span>${scan.step}…${scan.status === 'reading' && scan.progress > 0 && scan.progress < 1 ? ` ${Math.round(scan.progress * 100)}%` : ''}</div>
        <div class="muted small">Pick a category while it reads.${scan.step?.startsWith('Loading') ? ' The first scan downloads the reader once (about 6 MB).' : ''}</div>`}
      ${scan.status === 'error' && html`<div class="scan-status neg">Couldn't read it: ${scan.error}</div>`}
      ${scan.status === 'done' && html`
        <div class="scan-msg">${scan.parsed.total
          ? html`Found <b>${money(scan.parsed.total, cur)}</b>${scan.parsed.date ? ` · ${shortDate(scan.parsed.date)}` : ''}. Tap another amount if that's wrong.`
          : html`Couldn't find the total. Tap the right amount or type it.`}</div>
        ${scan.parsed.candidates.length > 0 && html`<div class="chips">
          ${scan.parsed.candidates.map(c => html`<button class=${'chip' + (num === c.value ? ' on' : '')} onClick=${() => { touched.current = true; setAmount(String(c.value)); }}>
            ${money(c.value, cur)}${c.label ? html`<small>${c.label}</small>` : ''}</button>`)}
        </div>`}
        <div class="row-gap small">
          <button class="link" onClick=${() => startScan(lastFile.current, (rotation.current + 90) % 360)}>↻ Rotate & read again</button>
          <button class="link" onClick=${() => setShowText(!showText)}>${showText ? 'Hide' : 'Show'} text</button>
        </div>
        ${showText && html`<pre class="ocr-text">${scan.parsed.text}</pre>`}
      `}
    </div>`}

    <div class=${'section-label' + (tried && !cat ? ' neg' : '')}>${tried && !cat ? 'Pick a category' : 'Category'}</div>
    <div class="cat-grid">
      ${settings.cats.map(c => html`<button class=${'cat-pick' + (cat === c.id ? ' on' : '')} style=${{ '--c': c.color }} onClick=${() => setCat(c.id)}>
        <span class="cat-ico" style=${{ background: c.color + '22', color: c.color }}>${c.icon}</span><span>${c.name}</span>
      </button>`)}
    </div>

    <div class="photo-row">
      ${photoUrl
        ? html`<button class="thumb" onClick=${() => setViewer(true)}><img src=${photoUrl} alt="Receipt photo" /></button>`
        : html`<div class="thumb empty">🧾</div>`}
      <div class="photo-actions">
        <button class="btn scan" onClick=${() => pick(camRef)}>📷 ${photo ? 'Retake' : 'Scan receipt'}</button>
        <button class="btn ghost" onClick=${() => pick(galRef)}>🖼 From gallery</button>
        ${photo && html`<button class="link neg" onClick=${() => { run.current++; setPhoto(null); setPhotoChanged(true); setScan(null); }}>Remove photo</button>`}
      </div>
    </div>

    <div class="section-label">Paper receipt</div>
    <div class="seg three">
      <button class=${!rc ? 'on' : ''} onClick=${() => setRc(null)}>None</button>
      <button class=${rc === 'pending' ? 'on' : ''} onClick=${() => setRc('pending')}>To hand in</button>
      <button class=${rc === 'collected' ? 'on' : ''} onClick=${() => setRc('collected')}>Handed in</button>
    </div>
    ${rc === 'collected' && html`<label class="field">Batch
      <select value=${batch} onChange=${e => setBatch(e.target.value)}>
        <option value="">Earlier / no batch</option>
        ${batches.map(b => html`<option value=${b.id}>${b.name} (${shortDate(b.date)})</option>`)}
      </select></label>`}

    <div class="two">
      <label class="field">Date<input type="date" value=${date} onInput=${e => setDate(e.target.value || today())} /></label>
      <label class="field">Note<input value=${note} placeholder="Shop, item…" onInput=${e => setNote(e.target.value)} /></label>
    </div>

    ${existing && html`<div class="row-gap danger-zone">
      <${Confirm} label="Delete" confirmLabel="Tap again to delete" onConfirm=${() => {
        const copy = { ...existing };
        store.delEntry(existing.id); photos.del(existing.id);
        toast('Deleted', { label: 'Undo', fn: () => store.putEntry(copy) });
        onDone();
      }} />
    </div>`}

    <div class="save-bar">
      <button class=${'btn primary wide' + (valid ? '' : ' soft')} onClick=${save}>
        ${valid ? `Save ${money(roundAmount(num, cur), cur)}` : !(num > 0) ? 'Type or scan the amount' : 'Pick a category'}
      </button>
    </div>
    ${viewer && photoUrl && html`<div class="viewer" onClick=${() => setViewer(false)}><img src=${photoUrl} alt="Receipt photo" /></div>`}
  </div>`;
}

// ---------- Settings ----------
const OCR_LANGS = [['jpn', 'Japanese'], ['eng', 'English'], ['rus', 'Russian']];
const QUICK = ['JPY', 'USD', 'EUR', 'RUB', 'GBP', 'KRW', 'CNY', 'TWD', 'HKD', 'THB', 'VND', 'SGD', 'AUD', 'CAD', 'KZT', 'GEL', 'TRY', 'UAH'];

function Settings({ s }) {
  const { settings } = s;
  const sy = useSync();
  const [editCat, setEditCat] = useState(null);
  const fx = useRates(settings.cur);
  const set = p => store.setSettings(p);
  const toggleIn = (key, v) => {
    const list = settings[key] || [];
    set({ [key]: list.includes(v) ? list.filter(x => x !== v) : [...list, v] });
  };
  const n = Object.keys(s.entries).length;

  return html`<div class="page">
    <header class="top"><h1>Settings</h1><${SyncDot} /></header>

    <section class="card pad">
      <h2>Phone ↔ PC sync</h2>
      ${sy.status === 'off' && html`<p class="muted">Sync isn't set up.</p>`}
      ${sy.user ? html`<p>Signed in as <b>${sy.user.email}</b> · ${{ synced: 'all synced ✓', syncing: 'syncing…', error: 'error' }[sy.status] || sy.status}</p>
        <button class="btn ghost" onClick=${signOutUser}>Sign out</button>`
      : sy.status !== 'off' && html`<p class="muted">Sign in with the same Google account on your phone and PC to share one budget. Works offline and catches up later.</p>
        <button class="btn primary" onClick=${signIn}>Sign in with Google</button>`}
      ${sy.error && html`<p class="neg small">${sy.error}</p>`}
    </section>

    <section class="card pad">
      <h2>Money</h2>
      <label class="field">Main currency (totals and budgets)
        <select value=${settings.cur} onChange=${e => set({ cur: e.target.value, curs: [...new Set([e.target.value, ...settings.curs])] })}>
          ${CURRENCIES.map(c => html`<option value=${c[0]}>${c[0]} ${c[1]} · ${c[2]}</option>`)}
        </select></label>
      <label class="field">Monthly budget, all categories (${settings.cur}, 0 = none)
        <input inputmode="decimal" value=${settings.budget || ''} placeholder="0"
          onChange=${e => set({ budget: parseFloat(e.target.value.replace(/[^\d.]/g, '')) || 0 })} /></label>
      <div class="field">Currencies you use
        <div class="chips">${[...new Set([...settings.curs, ...QUICK])].map(c => html`<button class=${'chip' + (settings.curs.includes(c) ? ' on' : '')} onClick=${() => c !== settings.cur && toggleIn('curs', c)}>${c} ${CUR[c]?.[1]}</button>`)}</div>
      </div>
      <p class="muted small">Other currencies are converted to ${settings.cur} for totals with daily rates${fx?.date ? ` (${shortDate(fx.date)})` : ''}. Receipt batches show each currency separately.</p>
    </section>

    <section class="card pad">
      <div class="row-between"><h2>Categories</h2><button class="link" onClick=${() => setEditCat({ id: uid(), name: '', icon: '🏷️', color: COLORS[settings.cats.length % COLORS.length], budget: 0, isNew: true })}>＋ Add</button></div>
      ${settings.cats.map(c => html`<button class="cat-row plain" onClick=${() => setEditCat(c)}>
        <span class="cat-ico sm" style=${{ background: c.color + '22', color: c.color }}>${c.icon}</span>
        <span class="cat-name">${c.name}</span>
        <span class="muted small">${c.budget > 0 ? money(c.budget, settings.cur, { round: true }) + ' / month' : ''}</span>
        <span class="chev">›</span>
      </button>`)}
    </section>

    <section class="card pad">
      <h2>Receipt scanning</h2>
      <p class="muted small">Receipts are read on your phone for free. Nothing is sent anywhere. Pick the languages your receipts are in (fewer = faster).</p>
      <div class="chips">${OCR_LANGS.map(([k, l]) => html`<button class=${'chip' + (settings.ocr?.includes(k) ? ' on' : '')} onClick=${() => { if (!(settings.ocr?.length === 1 && settings.ocr[0] === k)) toggleIn('ocr', k); }}>${l}</button>`)}</div>
      <label class="switch"><input type="checkbox" checked=${settings.photos} onChange=${e => set({ photos: e.target.checked })} />
        <span>Sync receipt photos to your PC (small, black & white)</span></label>
      <button class="btn ghost" onClick=${() => { warmUp(settings.ocr); toast('Downloading the reader for offline use…'); }}>Download reader for offline use</button>
    </section>

    <section class="card pad">
      <h2>Your data</h2>
      <p class="muted small">${n} expense${n === 1 ? '' : 's'}, ${Object.keys(s.batches).length} receipt batch${Object.keys(s.batches).length === 1 ? '' : 'es'}.</p>
      <button class="btn ghost" onClick=${() => exportCsv(s)}>Export CSV (Excel / Sheets)</button>
    </section>
    <p class="muted small center">Budget ${VERSION}</p>

    ${editCat && html`<${CatEditor} cat=${editCat} settings=${settings} s=${s} onClose=${() => setEditCat(null)} />`}
  </div>`;
}

function CatEditor({ cat, settings, s, onClose }) {
  const [c, setC] = useState({ ...cat });
  const used = Object.values(s.entries).filter(e => e.cat === cat.id).length;
  const idx = settings.cats.findIndex(x => x.id === cat.id);
  const save = () => {
    const { isNew, ...clean } = c;
    clean.name = clean.name.trim() || 'Category';
    clean.icon = [...(clean.icon || '🏷️')].slice(0, 2).join('') || '🏷️';
    const cats = isNew ? [...settings.cats, clean] : settings.cats.map(x => (x.id === c.id ? clean : x));
    store.setSettings({ cats });
    onClose();
  };
  const move = d => {
    const cats = [...settings.cats];
    const [x] = cats.splice(idx, 1);
    cats.splice(Math.max(0, Math.min(cats.length, idx + d)), 0, x);
    store.setSettings({ cats });
  };
  return html`<${Modal} title=${cat.isNew ? 'New category' : 'Edit category'} onClose=${onClose}>
    <form class="form" onSubmit=${e => { e.preventDefault(); save(); }}>
      <div class="two narrow-first">
        <label>Icon<input class="emoji-in" value=${c.icon} onInput=${e => setC({ ...c, icon: e.target.value })} /></label>
        <label>Name<input value=${c.name} placeholder="e.g. Coffee" onInput=${e => setC({ ...c, name: e.target.value })} /></label>
      </div>
      <label>Monthly budget (${settings.cur}, 0 = none)<input inputmode="decimal" value=${c.budget || ''} placeholder="0"
        onInput=${e => setC({ ...c, budget: parseFloat(e.target.value.replace(/[^\d.]/g, '')) || 0 })} /></label>
      <div class="swatches">${COLORS.map(col => html`<button type="button" aria-label=${'Color ' + col} class=${'swatch' + (c.color === col ? ' on' : '')} style=${{ background: col }} onClick=${() => setC({ ...c, color: col })}></button>`)}</div>
      <button class="btn primary wide" type="submit">Save</button>
      ${!cat.isNew && html`<div class="row-gap">
        <button type="button" class="btn ghost" disabled=${idx === 0} onClick=${() => move(-1)}>↑ Up</button>
        <button type="button" class="btn ghost" disabled=${idx === settings.cats.length - 1} onClick=${() => move(1)}>↓ Down</button>
        <${Confirm} label="Delete" confirmLabel=${used ? `Delete? ${used} expense${used === 1 ? '' : 's'} become "Uncategorized"` : 'Tap again to delete'}
          onConfirm=${() => { store.setSettings({ cats: settings.cats.filter(x => x.id !== cat.id) }); onClose(); }} />
      </div>`}
    </form>
  </${Modal}>`;
}

function exportCsv(s) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Date', 'Category', 'Amount', 'Currency', 'Note', 'Receipt', 'Batch', 'Batch date']];
  for (const e of Object.values(s.entries).sort((a, b) => a.date.localeCompare(b.date))) {
    const b = e.batch && s.batches[e.batch];
    rows.push([e.date, catOf(s.settings, e.cat).name, e.amount, e.cur, e.note,
      { pending: 'To hand in', collected: 'Handed in' }[e.rc] || '', b?.name || '', b?.date || '']);
  }
  const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `budget-${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- App ----------
function App() {
  const s = useStore();
  const route = useRoute();
  const [tab, setTab] = useState(TABS.includes(route) ? route : 'home');
  const [month, setMonth] = useState(monthOf(today()));
  const [file, setFile] = useState(null);
  const fileRef = useRef();
  const isTab = TABS.includes(route);
  const overlay = isTab ? null : route.startsWith('add') || route.startsWith('edit/') ? route : null;

  useEffect(() => {
    if (isTab) { setTab(route); pushedOverlay = false; }
    else if (!overlay) location.replace('#home');
  }, [route]);
  useEffect(() => { document.body.classList.toggle('lock', !!overlay); }, [overlay]);

  const startScan = () => {
    fileRef.current.value = '';
    fileRef.current.click();
    warmUp(s.settings.ocr?.length ? s.settings.ocr : ['jpn', 'eng']);
  };
  const onFile = e => { const f = e.target.files[0]; if (f) { setFile(f); openOverlay('add'); } };
  const onEdit = id => openOverlay('edit/' + id);

  return html`
    <input type="file" accept="image/*" capture="environment" ref=${fileRef} onChange=${onFile} hidden />
    <main class=${overlay ? 'hidden' : ''}>
      ${tab === 'home' && html`<${Home} s=${s} month=${month} setMonth=${setMonth} onEdit=${onEdit} />`}
      ${tab === 'receipts' && html`<${Receipts} s=${s} onEdit=${onEdit} />`}
      ${tab === 'settings' && html`<${Settings} s=${s} />`}
    </main>
    ${!overlay && tab !== 'settings' && html`<div class="fab">
      <button class="btn scan big" onClick=${startScan}>📷 Scan</button>
      <button class="btn primary big" onClick=${() => openOverlay('add')}>＋ Add</button>
    </div>`}
    ${!overlay && html`<nav class="tabs">
      ${[['home', '🏠', 'Budget'], ['receipts', '🧾', 'Receipts'], ['settings', '⚙️', 'Settings']].map(([k, i, l]) => html`
        <a href=${'#' + k} class=${tab === k ? 'on' : ''}><span>${i}</span>${l}${k === 'receipts' && pendingCount(s) > 0 ? html`<b class="dot">${pendingCount(s)}</b>` : ''}</a>`)}
    </nav>`}
    ${overlay && html`<${Editor} key=${overlay} route=${overlay} file=${file} s=${s} onDone=${() => { setFile(null); closeOverlay(tab); }} />`}
    <${Toast} />
  `;
}
const pendingCount = s => Object.values(s.entries).filter(e => e.rc === 'pending').length;

render(html`<${App} />`, document.getElementById('app'));
initSync();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
