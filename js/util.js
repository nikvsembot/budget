// Small helpers: ids, dates, currencies and money formatting.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const isoDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => isoDate(new Date());
export const monthOf = iso => iso.slice(0, 7);
export const parseISO = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d || 1); };

export function monthLabel(ym) {
  return parseISO(ym + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
export function shiftMonth(ym, n) {
  const d = parseISO(ym + '-01'); d.setMonth(d.getMonth() + n); return isoDate(d).slice(0, 7);
}
export function dayLabel(iso) {
  const t = today(), y = isoDate(new Date(Date.now() - 86400e3));
  if (iso === t) return 'Today';
  if (iso === y) return 'Yesterday';
  return parseISO(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
export const shortDate = iso => parseISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: iso.slice(0, 4) === today().slice(0, 4) ? undefined : 'numeric' });

// code, symbol, name, decimals
export const CURRENCIES = [
  ['JPY', '¥', 'Japanese yen', 0], ['USD', '$', 'US dollar', 2], ['EUR', '€', 'Euro', 2], ['RUB', '₽', 'Russian ruble', 2],
  ['GBP', '£', 'British pound', 2], ['KRW', '₩', 'Korean won', 0], ['CNY', '元', 'Chinese yuan', 2], ['TWD', 'NT$', 'Taiwan dollar', 0],
  ['HKD', 'HK$', 'Hong Kong dollar', 2], ['THB', '฿', 'Thai baht', 2], ['VND', '₫', 'Vietnamese dong', 0], ['PHP', '₱', 'Philippine peso', 2],
  ['IDR', 'Rp', 'Indonesian rupiah', 0], ['MYR', 'RM', 'Malaysian ringgit', 2], ['SGD', 'S$', 'Singapore dollar', 2], ['INR', '₹', 'Indian rupee', 2],
  ['AUD', 'A$', 'Australian dollar', 2], ['NZD', 'NZ$', 'New Zealand dollar', 2], ['CAD', 'C$', 'Canadian dollar', 2], ['CHF', 'CHF', 'Swiss franc', 2],
  ['PLN', 'zł', 'Polish zloty', 2], ['CZK', 'Kč', 'Czech koruna', 2], ['TRY', '₺', 'Turkish lira', 2], ['KZT', '₸', 'Kazakh tenge', 2],
  ['UAH', '₴', 'Ukrainian hryvnia', 2], ['GEL', '₾', 'Georgian lari', 2], ['AMD', '֏', 'Armenian dram', 0], ['AED', 'AED', 'UAE dirham', 2],
];
export const CUR = Object.fromEntries(CURRENCIES.map(c => [c[0], c]));
export const decimals = cur => CUR[cur]?.[3] ?? 2;
export const symbol = cur => CUR[cur]?.[1] ?? cur;

const fmts = new Map();
export function money(amount, cur, opts = {}) {
  const d = opts.round ? 0 : decimals(cur);
  const k = cur + d;
  if (!fmts.has(k)) {
    try {
      fmts.set(k, new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', minimumFractionDigits: d, maximumFractionDigits: d }));
    } catch {
      fmts.set(k, { format: n => `${symbol(cur)}${n.toFixed(d)}` });
    }
  }
  return fmts.get(k).format(amount || 0);
}
// {JPY: 1200, USD: 5} -> "¥1,200 + $5.00"
export const moneyMix = sums => Object.entries(sums).filter(([, v]) => v).map(([c, v]) => money(v, c)).join(' + ') || money(0, Object.keys(sums)[0] || 'JPY');
export function sumByCur(entries) {
  const s = {};
  for (const e of entries) s[e.cur] = (s[e.cur] || 0) + e.amount;
  for (const c in s) s[c] = Math.round(s[c] * 100) / 100;
  return s;
}
export function roundAmount(v, cur) {
  const f = 10 ** decimals(cur);
  return Math.round(v * f) / f;
}
