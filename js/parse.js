// Finds the total, the date and the currency in the text that the on-phone OCR read from a receipt.
// Works for Japanese, English and Russian receipts. Pure functions, so they can be tested in Node.

const CJK = '\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef';

// Words that mark the line with the amount actually paid (spaces removed, lower case).
const TOTAL = ['合計', '総合計', 'お買上計', 'お買上げ計', 'お買い上げ計', '御買上', '買上計', '買上合計', 'ご請求', '請求額',
  'お支払', 'お支払い', '支払金額', '支払額', 'お会計', '税込合計', '合計金額',
  '台計', '合針', '含計', '会計', // common OCR misreads of 合計
  'total', 'grandtotal', 'amountdue', 'balancedue', 'totaldue', 'totalamount',
  'итог', 'итого', 'всего', 'ксплате', 'коплате', 'суммакоплате'];
const SUBTOTAL = ['小計', 'subtotal', 'sub-total', 'подытог', 'промежуточный'];
// Lines whose amount is not the total (cash handed over, change, tax, item counts, card balance...).
const NOT_TOTAL = [
  ['預', 9], ['お釣', 9], ['釣銭', 9], ['おつり', 9], ['釣り', 9], ['残高', 9], ['change', 9], ['tendered', 9], ['cash', 4], ['現金', 4],
  ['сдача', 9], ['наличн', 5], ['получено', 9],
  ['税', 6], ['対象', 6], ['tax', 6], ['vat', 6], ['ндс', 6], ['налог', 6],
  ['点数', 7], ['ポイント', 7], ['point', 7], ['pts', 7], ['баллы', 7], ['бонус', 7],
  ['値引', 5], ['割引', 5], ['discount', 5], ['скидка', 5], ['tel', 10], ['電話', 10], ['тел', 10], ['no.', 4],
];

const SYMBOLS = { '¥': 'JPY', '円': 'JPY', '\\': 'JPY', '$': 'USD', '€': 'EUR', '£': 'GBP', '₩': 'KRW', '원': 'KRW', '₽': 'RUB', 'руб': 'RUB', '฿': 'THB', '₸': 'KZT', '₴': 'UAH', '₾': 'GEL', '₺': 'TRY', '₫': 'VND', '₱': 'PHP', '₹': 'INR' };

export function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(new RegExp(`([${CJK}])[ \\t]+(?=[${CJK}])`, 'g'), '$1') // OCR puts spaces between kanji: 合 計 -> 合計
    .replace(/(\d)[ \t]*([,.])[ \t]*(\d{3})(?!\d)/g, '$1$2$3')        // 1, 280 -> 1,280
    .replace(/(^|[\s=:])[Ss](?=\d+[.,]\d{2}(?!\d))/gm, '$1$') // OCR reads $ as S: S23.47
    .replace(/[ \t]+/g, ' ');
}

// Turns "1,280" / "12.50" / "1.234,56" / "538" into a number.
export function toNumber(tok) {
  const s = tok.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  const m = s.match(/^(\d{1,3}(?:[.,]\d{3})+)([.,]\d{1,2})?$/);
  if (m) return parseFloat(m[1].replace(/[.,]/g, '') + (m[2] ? '.' + m[2].slice(1) : ''));
  const d = s.match(/^(\d+)(?:[.,](\d{1,2}))?$/);
  if (d) return parseFloat(d[1] + (d[2] ? '.' + d[2] : ''));
  return NaN;
}

const DATE_RES = [
  // 2026年11月24日, 2026/11/24, 2026-11-24, 2026.11.24
  [/(20\d{2})\s*[年/\-.]\s*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})/, m => [+m[1], +m[2], +m[3]]],
  // 令和8年11月24日, R8.11.24 (Reiwa year 1 = 2019)
  [/(?:令和|R)\s*(\d{1,2})\s*[年.\/]\s*(\d{1,2})\s*[月.\/]\s*(\d{1,2})/, m => [2018 + +m[1], +m[2], +m[3]]],
  // 24.11.2026 (Europe/Russia), 11/24/2026 (US) or 24/11/2026
  [/(\d{1,2})\s*([./\-])\s*(\d{1,2})\s*[./\-]\s*(20\d{2})/, (m, ctx) => {
    const a = +m[1], b = +m[3];
    if (a > 12) return [+m[4], b, a];          // 24/11/2026
    if (b > 12) return [+m[4], a, b];          // 11/24/2026
    return m[2] === '/' && ctx.us ? [+m[4], a, b] : [+m[4], b, a];
  }],
  // 26/11/24 (Japanese yy/mm/dd) or 24.11.26 (dd.mm.yy)
  [/(?<!\d)(\d{2})\s*([./\-])\s*(\d{1,2})\s*[./\-]\s*(\d{2})(?!\d)/, (m, ctx) => {
    const yy = ctx.year % 100;
    if (+m[1] === yy || +m[1] === yy - 1) return [2000 + +m[1], +m[3], +m[4]];
    if (+m[4] === yy || +m[4] === yy - 1) return [2000 + +m[4], +m[3], +m[1]];
    return null;
  }],
];

export function findDate(lines, today = new Date(), opts = {}) {
  const ctx = { year: today.getFullYear(), us: opts.us };
  const max = new Date(today.getTime() + 2 * 86400e3), min = new Date(today.getTime() - 3 * 365 * 86400e3);
  for (const line of lines) {
    for (const [re, fn] of DATE_RES) {
      const m = line.match(re);
      if (!m) continue;
      const r = fn(m, ctx);
      if (!r) continue;
      const [y, mo, d] = r;
      const dt = new Date(y, mo - 1, d);
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || dt.getMonth() !== mo - 1 || dt > max || dt < min) continue;
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return null;
}

function stripNoise(line) {
  return line
    .replace(/(20\d{2})\s*[年/\-.]\s*\d{1,2}\s*[月/\-.]\s*\d{1,2}日?/g, ' ')
    .replace(/(?:令和|R)\s*\d{1,2}\s*[年.\/]\s*\d{1,2}\s*[月.\/]\s*\d{1,2}日?/g, ' ')
    .replace(/\d{1,2}\s*[./\-]\s*\d{1,2}\s*[./\-]\s*\d{2,4}/g, ' ')
    .replace(/\d{1,2}\s*[:時]\s*\d{2}(?:\s*[:分]\s*\d{2})?秒?/g, ' ')  // times
    .replace(/\d{2,5}-\d{2,4}-\d{3,4}/g, ' ')                        // phone numbers
    .replace(/[*xX]{3,}\d+/g, ' ');                                  // ****1234 card numbers
}

const AMOUNT_RE = /(¥|\\|\$|€|£|₩|₽|฿|₸|₴|₾|₺|₫|₱|₹|[YＹ](?=\d))?\s?(-?\d{1,3}(?:[,.']\d{3})+(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?)(?!\d)(\s?(?:円|원|руб\.?|р\.|₽|%|点|個|コ|枚|本|ml|mL|L|g|kg|㎏|cm|шт|кг|г\b|pcs|items?))?/g;

function amountsIn(line, ctx) {
  const out = [];
  const clean = stripNoise(line);
  for (const m of clean.matchAll(AMOUNT_RE)) {
    const [, pre, num, suf] = m;
    const s = (suf || '').trim();
    if (s && !/^(円|원|руб\.?|р\.|₽)$/.test(s)) continue; // 8%, 3点, 500ml ...
    const prevCh = clean[m.index + m[0].indexOf(num) - 1];
    if (prevCh && /[A-Za-zА-Яа-я#№]/.test(prevCh) && !pre) continue; // "No1234", "#0012"
    const digits = num.replace(/\D/g, '');
    if (/^0\d/.test(digits) && !/[.,]/.test(num)) continue; // 0002 (register numbers)
    if (digits.length >= 8 && !/[.,]/.test(num)) continue;  // barcodes, transaction ids
    if (num.startsWith('-')) continue;
    let value = toNumber(num);
    if (!isFinite(value) || value <= 0) continue;
    let cur = null;
    if (pre) cur = pre === 'Y' || pre === 'Ｙ' ? (ctx.jpn ? 'JPY' : null) : SYMBOLS[pre];
    if (!cur && s) cur = SYMBOLS[s.replace(/\.$/, '')] || (/^р\.$/.test(s) ? 'RUB' : null);
    if (pre && (pre === 'Y' || pre === 'Ｙ') && !cur) continue;
    if (cur === 'JPY' && !Number.isInteger(value)) value = Math.round(value);
    out.push({ value, cur, marked: !!(pre || s), dec: /[.,]\d{1,2}$/.test(num) });
  }
  return out;
}

const has = (key, list) => list.some(w => key.includes(w));

export function parseReceipt(text, opts = {}) {
  const today = opts.today || new Date();
  const lines = normalize(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const ctx = { jpn: opts.jpn !== false };

  // Currency of the receipt: the most frequent currency mark.
  const curCount = {};
  const rows = lines.map((line, i) => {
    const key = line.toLowerCase().replace(/\s+/g, '');
    const amounts = amountsIn(line, ctx);
    for (const a of amounts) if (a.cur) curCount[a.cur] = (curCount[a.cur] || 0) + 1;
    if (/円/.test(line) && !amounts.some(a => a.cur)) curCount.JPY = (curCount.JPY || 0) + 0.5;
    return { i, line, key, amounts };
  });
  const cur = Object.entries(curCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const date = findDate(lines, today, { us: cur === 'USD' });

  const cands = [];
  const tendered = [], change = [];
  rows.forEach((r, idx) => {
    const isTotal = has(r.key, TOTAL) && !has(r.key, SUBTOTAL);
    const isSub = has(r.key, SUBTOTAL);
    let penalty = 0;
    for (const [w, p] of NOT_TOTAL) if (r.key.includes(w)) penalty = Math.max(penalty, p);
    if (isTotal) penalty = Math.min(penalty, /税|tax|ндс/.test(r.key) && !/税込/.test(r.key) ? 3 : 0);
    let amounts = r.amounts;
    let label = stripNoise(r.line).replace(/[¥\\$€£₩₽]?\s?\d[\d,.']*\s?(?:円|руб\.?|р\.)?/g, ' ').replace(/[=:()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 16);
    // Keyword alone on its line: the amount is usually on the next line.
    const next = rows[idx + 1];
    if ((isTotal || isSub) && !amounts.length && next && !/[a-zа-я\u3040-\u30ff\u3400-\u9fff]/i.test(next.key)) amounts = next.amounts;
    if (/預|現金|tendered|cash|получено|наличн/.test(r.key) && !isTotal) tendered.push(...amounts.map(a => a.value));
    if (/釣|change|сдача/.test(r.key)) change.push(...amounts.map(a => a.value));
    amounts.forEach((a, k) => {
      let score = 0;
      if (isTotal) score += 10 + (k === amounts.length - 1 ? 1 : 0);
      else if (isSub) score += 4;
      score -= penalty;
      if (a.marked) score += 2;
      if (cur && a.cur && a.cur !== cur) score -= 2;
      if (cur && cur !== 'JPY' && !a.dec && !a.marked && !isTotal) score -= 1;
      score += (idx / Math.max(1, rows.length)) * 1.5; // totals sit in the lower part
      cands.push({ value: a.value, score, label, line: r.i });
    });
  });

  // Paid = handed over - change: a strong hint.
  for (const t of tendered) for (const c of change) {
    const v = Math.round((t - c) * 100) / 100;
    for (const cd of cands) if (Math.abs(cd.value - v) < 0.005) cd.score += 6;
  }
  // The total is normally the largest amount that is not cash handed over or a balance.
  const ok = cands.filter(c => c.score > -2);
  const maxOk = Math.max(0, ...ok.map(c => c.value));
  for (const c of cands) if (c.value === maxOk && c.score > -2) c.score += 2;

  const byValue = new Map();
  for (const c of cands) {
    const prev = byValue.get(c.value);
    if (!prev) byValue.set(c.value, { ...c });
    else {
      if (c.score > prev.score) { prev.label = c.label; prev.line = c.line; }
      prev.score = Math.max(prev.score, c.score) + 0.5;
    }
  }
  const candidates = [...byValue.values()].sort((a, b) => b.score - a.score || b.value - a.value).slice(0, 8);
  const total = candidates.length && candidates[0].score > 0 ? candidates[0].value : null;
  return { total, cur, date, candidates, lines };
}
