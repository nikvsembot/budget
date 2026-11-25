"""End-to-end check of the free receipt scan, in headless Chrome at phone size.

Makes fake phone photos of receipts (tilted, shadowed, blurred, on a table), feeds each one to the app's
Scan button and reports the amount the app filled in. Also saves screenshots of the main screens.

    python3 -I test/e2e_scan.py <app dir>
"""
import functools, http.server, io, json, os, random, sys, threading, time
from PIL import Image, ImageDraw, ImageFilter
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
OUT = os.path.join(ROOT, 'test', 'out')
os.makedirs(OUT, exist_ok=True)

RECEIPTS = [
    ('lawson', 538, '''<div class=c><b class=big>LAWSON</b><br>ローソン 渋谷道玄坂店<br>電話:03-3464-1234</div>
<div>2026年11月24日(火) 18:32 レジ0002</div><div class=c><b>領 収 証</b></div>
<div class=r><span>おにぎり 鮭</span><span>¥160</span></div>
<div class=r><span>伊右衛門 500ml</span><span>¥140</span></div>
<div class=r><span>からあげクン レギュラー</span><span>¥238</span></div>
<div class=r><span>小 計</span><span>¥538</span></div>
<div class=r><span>(内消費税等 8%</span><span>¥39)</span></div>
<div class="r big"><span>合 計</span><span>¥538</span></div>
<div class=r><span>お預り</span><span>¥1,000</span></div>
<div class=r><span>お釣り</span><span>¥462</span></div>
<div>上記正に領収いたしました</div>'''),
    ('aeon', 1984, '''<div class=c><b class=big>イオン 品川シーサイド店</b><br>TEL 03-5463-1111</div>
<div>2026/11/20(金) 10:05</div>
<div class=r><span>明治おいしい牛乳</span><span>¥268</span></div>
<div class=r><span>超熟 6枚</span><span>¥198</span></div>
<div class=r><span>国産鶏もも肉</span><span>¥612</span></div>
<div class=r><span>キャベツ</span><span>¥178</span></div>
<div class=r><span>洗剤 アタック</span><span>¥581</span></div>
<div class=r><span>小計 5点</span><span>¥1,837</span></div>
<div class=r><span>外税 8% 対象額</span><span>¥1,837</span></div>
<div class=r><span>外税</span><span>¥147</span></div>
<div class="r big"><span>合計</span><span>¥1,984</span></div>
<div class=r><span>クレジット</span><span>¥1,984</span></div>'''),
    ('english', 23.47, '''<div class=c><b class=big>CORNER MARKET</b><br>123 Main St</div>
<div>11/22/2026 14:22</div>
<div class=r><span>MILK 1GAL</span><span>4.29</span></div>
<div class=r><span>EGGS DOZEN</span><span>3.99</span></div>
<div class=r><span>COFFEE BEANS</span><span>12.49</span></div>
<div class=r><span>SUBTOTAL</span><span>20.77</span></div>
<div class=r><span>TAX</span><span>2.70</span></div>
<div class="r big"><span>TOTAL</span><span>$23.47</span></div>
<div class=r><span>CASH</span><span>30.00</span></div>
<div class=r><span>CHANGE</span><span>6.53</span></div>'''),
]
CSS = '''body{margin:0;background:#fff} .p{width:380px;padding:26px 22px 40px;font:17px/1.5 "Noto Sans CJK JP","Noto Sans Mono CJK JP",monospace;color:#222;background:#fbfaf6}
.c{text-align:center}.r{display:flex;justify-content:space-between}.big{font-size:21px;font-weight:700}div{margin:3px 0}'''


def receipt_png(page, body):
    page.set_content(f'<style>{CSS}</style><div class=p>{body}</div>')
    return Image.open(io.BytesIO(page.locator('.p').screenshot()))


def phone_photo(rec, seed):
    rnd = random.Random(seed)
    W, H = 3000, 4000
    bg = Image.new('RGB', (W, H), (92, 70, 52))
    d = ImageDraw.Draw(bg)
    for y in range(0, H, 7):  # wood-ish grain
        c = 80 + int(18 * ((y * 7919) % 97) / 97)
        d.line([(0, y), (W, y + rnd.randint(-20, 20))], fill=(c + 14, c - 4, c - 22), width=5)
    s = 2600 / rec.height
    rec = rec.resize((int(rec.width * s), int(rec.height * s)), Image.LANCZOS).convert('RGB')
    rec = rec.rotate(rnd.uniform(-4, 4), expand=True, fillcolor=(0, 0, 0))
    mask = Image.new('L', rec.size, 0)
    ImageDraw.Draw(mask).rectangle([2, 2, rec.width - 3, rec.height - 3], fill=255)
    mask = mask.rotate(0)
    m2 = rec.convert('L').point(lambda v: 255 if v > 8 else 0)
    bg.paste(rec, ((W - rec.width) // 2 + rnd.randint(-80, 80), (H - rec.height) // 2), m2)
    # uneven light: shadow from the phone across one corner
    shade = Image.new('L', (W, H), 0)
    sd = ImageDraw.Draw(shade)
    for i in range(60):
        sd.ellipse([-1800 + i * 25, 2200 + i * 20, 1400 - i * 10, 5600], fill=int(i * 1.6))
    bg = Image.composite(Image.new('RGB', (W, H), (25, 22, 20)), bg, shade.filter(ImageFilter.GaussianBlur(120)))
    bg = bg.filter(ImageFilter.GaussianBlur(rnd.uniform(1.2, 2.0)))
    buf = io.BytesIO()
    bg.save(buf, 'JPEG', quality=82)
    return buf.getvalue()


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    h.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    srv = serve()
    results = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--disable-web-security'])
        page = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        maker = b.new_page(device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.goto('http://127.0.0.1:8765/index.html#home')
        page.wait_for_selector('.fab')
        page.screenshot(path=f'{OUT}/01-home-empty.png')
        for i, (name, want, body) in enumerate(RECEIPTS):
            photo = phone_photo(receipt_png(maker, body), i)
            path = f'{OUT}/photo-{name}.jpg'
            open(path, 'wb').write(photo)
            t = time.time()
            with page.expect_file_chooser() as fc:
                page.click('.fab .btn.scan')
            fc.value.set_files(path)
            page.wait_for_selector('.scan-box.done, .scan-box.error', timeout=180000)
            secs = time.time() - t
            got = page.input_value('.amount-input')
            status = page.inner_text('.scan-box')
            ok = abs(float(got or 0) - want) < 0.005
            results.append((name, want, got, ok, round(secs, 1)))
            print(('ok  ' if ok else 'MISS'), name, 'want', want, 'got', got, f'{secs:.1f}s |', status.splitlines()[0][:90], flush=True)
            if i == 0:
                page.screenshot(path=f'{OUT}/02-scan-result.png')
                page.click('.cat-pick >> nth=0')
                page.screenshot(path=f'{OUT}/03-editor-filled.png', full_page=True)
            else:
                page.click('.cat-pick >> nth=1')
            if not ok and got == '':
                page.fill('.amount-input', str(want))
            page.click('.save-bar .btn')
            page.wait_for_selector('.fab')
        # a typed entry in another currency
        page.click('.fab .btn.primary')
        page.fill('.amount-input', '1200')
        page.click('.cat-pick >> nth=2')
        page.click('.save-bar .btn')
        page.wait_for_selector('.fab')
        time.sleep(0.5)
        page.screenshot(path=f'{OUT}/04-home.png', full_page=True)
        page.click('.tabs a[href="#receipts"]')
        page.wait_for_selector('.sel-row')
        page.click('text=Select all')
        page.screenshot(path=f'{OUT}/05-receipts.png')
        page.click('.action-bar .btn')
        page.screenshot(path=f'{OUT}/06-handin.png')
        page.click('.modal .btn.primary')
        page.wait_for_selector('.batch-body')
        time.sleep(0.4)
        page.screenshot(path=f'{OUT}/07-batches.png', full_page=True)
        page.click('.tabs a[href="#settings"]')
        page.wait_for_selector('text=Phone ↔ PC sync')
        page.screenshot(path=f'{OUT}/08-settings.png', full_page=True)
        state = page.evaluate('JSON.parse(localStorage.getItem("budget.v1"))')
        b.close()
    srv.shutdown()
    n = len(state['entries'])
    collected = sum(1 for e in state['entries'].values() if e['rc'] == 'collected')
    print(f'entries saved: {n}, handed in: {collected}, batches: {len(state["batches"])}')
    real_errors = [e for e in errors if 'Parameter not found' not in e and 'firebase' not in e.lower() and 'googleapis' not in e.lower() and 'frankfurter' not in e.lower() and 'net::' not in e]
    print('page errors:', real_errors[:5] or 'none')
    json.dump(results, open(f'{OUT}/results.json', 'w'))
    sys.exit(0 if all(r[3] for r in results) and n == 4 and collected == 3 and not real_errors else 1)


main()
