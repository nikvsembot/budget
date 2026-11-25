// Free receipt reading, done entirely on the phone with Tesseract (no server, no subscription).
// The engine (~3 MB) and language data (~2-3 MB each) download once, then work offline.
import { parseReceipt } from './parse.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
let worker = null, workerKey = '', starting = null, progressFn = null;

async function getWorker(langs) {
  const key = langs.join('+');
  if (worker && workerKey === key) return worker;
  if (starting) await starting.catch(() => {});
  if (worker && workerKey === key) return worker;
  starting = (async () => {
    if (worker) { await worker.terminate().catch(() => {}); worker = null; }
    const Tesseract = (await import('../vendor/tesseract/tesseract.esm.min.js')).default;
    const w = await Tesseract.createWorker(langs, 1, {
      workerPath: BASE + 'worker.min.js',
      corePath: BASE + 'core',
      langPath: BASE + 'lang',
      logger: m => progressFn?.(m),
      errorHandler: e => console.warn('ocr', e),
    });
    await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    worker = w; workerKey = key;
  })();
  try { await starting; } finally { starting = null; }
  return worker;
}

async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}

// Draws the photo turned by `deg` degrees (any angle), scaled so its longest side is at most maxSide.
function draw(src, deg, maxSide) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  const w = Math.round(src.width * s), h = Math.round(src.height * s);
  const a = (deg * Math.PI) / 180, cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
  const c = document.createElement('canvas');
  c.width = Math.round(w * cos + h * sin); c.height = Math.round(w * sin + h * cos);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2);
  g.rotate(a);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, -w / 2, -h / 2, w, h);
  return c;
}

// How crooked the receipt is in the photo: tries small angles and keeps the one where the
// printed lines line up best (sharpest row-by-row changes in dark pixels).
function skewAngle(src) {
  const small = flatten(draw(src, 0, 520));
  const t = document.createElement('canvas');
  const g = t.getContext('2d', { willReadFrequently: true });
  const score = deg => {
    const a = (deg * Math.PI) / 180;
    t.width = small.width; t.height = small.height;
    g.fillStyle = '#fff'; g.fillRect(0, 0, t.width, t.height);
    g.setTransform(1, 0, 0, 1, t.width / 2, t.height / 2);
    g.rotate(a);
    g.drawImage(small, -small.width / 2, -small.height / 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data;
    let prev = 0, sum = 0;
    for (let y = 0; y < t.height; y++) {
      let n = 0;
      for (let x = 0, k = y * t.width * 4; x < t.width; x++, k += 4) if (d[k] < 120) n++;
      sum += (n - prev) * (n - prev); prev = n;
    }
    return sum;
  };
  let best = 0, bestS = score(0);
  for (let deg = -15; deg <= 15; deg += 1) { if (!deg) continue; const v = score(deg); if (v > bestS) { bestS = v; best = deg; } }
  const coarse = best;
  for (let deg = coarse - 0.75; deg <= coarse + 0.75; deg += 0.25) { const v = score(deg); if (v > bestS) { bestS = v; best = deg; } }
  return best;
}

// Evens out shadows and uneven light: each pixel is divided by the brightness around it,
// so the paper becomes white and the print stays dark.
function flatten(c) {
  const g = c.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = c;
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const n = w * h, gray = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) gray[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
  const W = w + 1, S = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += gray[y * w + x]; S[(y + 1) * W + x + 1] = S[y * W + x + 1] + row; }
  }
  const r = Math.max(10, Math.round(Math.max(w, h) / 36));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const mean = (S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0]) / ((y1 - y0) * (x1 - x0));
      let v = (gray[y * w + x] / Math.max(mean * 0.92, 1)) * 255;
      v = v > 255 ? 255 : v < 0 ? 0 : v;
      v = 255 - (255 - v) * 1.25; // a little extra contrast
      const k = (y * w + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = v < 0 ? 0 : v;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function toJpeg(canvas, maxSide, quality) {
  const s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', quality));
}

// Photo -> {canvas for reading, small JPEG to keep}
export async function prepare(file, rotation = 0) {
  let src = await loadBitmap(file);
  if (rotation) { const r = draw(src, rotation, 2600); src.close?.(); src = r; }
  let skew = 0;
  try { skew = skewAngle(src); } catch {}
  const canvas = flatten(draw(src, skew, 2200));
  src.close?.();
  let photo = await toJpeg(canvas, 1400, 0.6);
  if (photo.size > 560e3) photo = await toJpeg(canvas, 1100, 0.45);
  return { canvas, photo, skew };
}

export async function recognize(canvas, { langs = ['jpn', 'eng'], onProgress } = {}) {
  progressFn = onProgress;
  try {
    const w = await getWorker(langs);
    const { data } = await w.recognize(canvas);
    return { text: data.text, confidence: data.confidence, ...parseReceipt(data.text, { jpn: langs.includes('jpn') }) };
  } finally { progressFn = null; }
}

// Start loading the engine early (e.g. while the camera is open).
export const warmUp = langs => getWorker(langs).catch(() => {});
