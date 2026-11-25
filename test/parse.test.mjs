import { parseReceipt, toNumber } from '../js/parse.js';
const today = new Date(2026, 10, 25);
const cases = [
  ['lawson', `ローソン 渋谷 店
電話 :03-1234-5678
2026年11月24日(火) 18:32 レジ0002
領 収 証
おにぎり 鮭 ¥160
お茶 500ml ¥140
からあげクン ¥238
小 計 ¥538
(内消費税等 8% ¥39)
合 計 ¥538
お預り ¥1, 000
お釣り ¥462`, 538, 'JPY', '2026-11-24'],
  ['super-tax', `イオン 品川店
2026/11/20 10:05
牛乳 ¥218
食パン ¥158 
卵 10個 ¥298
小計 3点 ¥674
外税 8% 対象額 ¥674
外税 ¥53
合計 ¥727
クレジット ¥727`, 727, 'JPY', '2026-11-20'],
  ['ic-card', `ファミリーマート
R8.11.23
コーヒーM 180円
合計 180円
交通系IC 180円
残高 2,345円`, 180, 'JPY', '2026-11-23'],
  ['ocr-yen-as-backslash', `セブンイレブン
2026年11月21日
弁当 \\598
合計 \\646
お預り \\1000
お釣 \\354`, 646, 'JPY', '2026-11-21'],
  ['us', `WALMART
11/22/2026 14:22
MILK 3.49
BREAD 2.99
SUBTOTAL 6.48
TAX 0.52
TOTAL 7.00
CASH 10.00
CHANGE 3.00`, 7.00, null, '2026-11-22'],
  ['ru', `ООО "Пятерочка"
24.11.2026 19:01
Хлеб 1 шт 45.90
Молоко 89.99
ИТОГ =135.89
НАЛИЧНЫМИ =200.00
СДАЧА =64.11
НДС 10% 12.35`, 135.89, null, '2026-11-24'],
  ['total-next-line', `カフェ
2026-11-19
ラテ ¥520
合計
¥520`, 520, 'JPY', '2026-11-19'],
  ['no-keyword', `XYZ
¥1,200
¥300
¥1,500`, 1500, 'JPY', null],
];
let fail = 0;
for (const [name, text, total, cur, date] of cases) {
  const r = parseReceipt(text, { today });
  const ok = r.total === total && (cur === null || r.cur === cur) && r.date === date;
  if (!ok) fail++;
  console.log(ok ? 'ok  ' : 'FAIL', name, '→', r.total, r.cur, r.date, '| top:', r.candidates.slice(0, 4).map(c => `${c.value}(${c.score.toFixed(1)} ${c.label})`).join(', '));
}
for (const [s, v] of [['1,280', 1280], ['12.50', 12.5], ['1.234,56', 1234.56], ['538', 538], ['12,5', 12.5]]) if (toNumber(s) !== v) { fail++; console.log('FAIL toNumber', s, toNumber(s)); }
console.log(fail ? `${fail} failed` : 'all passed'); process.exit(fail ? 1 : 0);
