#!/usr/bin/env python3
"""DANDY HOME の Webフォント（自社配信）を作り直すスクリプト。

使い方（リポジトリのルートで実行。詳しくは同じフォルダの README.md）:
  python3 _tools/fonts/build_fonts.py            サイトの文字を集計し、サブセットと fonts/fonts.css を作り直す
  python3 _tools/fonts/build_fonts.py --check    サブセットに足りない文字があるかだけを調べる（ファイルは変更しない）
  python3 _tools/fonts/build_fonts.py --refresh  予備フォント一式・欧文フォントも Google Fonts から取り直す（フォントの版の更新）

必要なもの: Python 3（標準ライブラリのみ）、Google Chrome、インターネット接続（--check 以外）。

しくみ:
  - 対象ページは git に登録済みの HTML（未公開のページは対象外）。ローカルで表示し、
    文字ごとに実際に使われる書体・太さ（CSS の font-family の並びと font-weight）を調べる。
  - 和文（Noto Sans JP / Shippori Mincho）は、使われている文字だけを含むサブセットを
    Google Fonts の text= 指定で作り、fonts/subset/ に置く。
  - 欧文（Manrope / Montserrat / Bodoni Moda）と和文の予備フォント一式は Google Fonts の
    配信ファイルをそのまま fonts/files/ に置く。予備フォントは fonts/fonts-fallback.css で
    ページ表示後に読み込まれ、サブセットにない文字だけが正しい書体で補われる。
"""
import base64, hashlib, html, http.server, json, os, re, shutil, socket, struct, subprocess
import sys, tempfile, threading, time, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONTS = os.path.join(ROOT, 'fonts')
FILES = os.path.join(FONTS, 'files')
SUBSET = os.path.join(FONTS, 'subset')
TOOLS = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(TOOLS, 'subset-chars.json')
LATIN_CSS = os.path.join(TOOLS, 'latin.css')  # 欧文フォントの @font-face（fonts.css の材料）
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
# woff2 で配信してもらうため、現行の Chrome と同じ User-Agent で Google Fonts に問い合わせる
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
API = 'https://fonts.googleapis.com/css2?'

# 欧文：配信ファイルをそのまま使う（小さく、unicode-range で必要な分だけ読み込まれる）
LATIN = {'Manrope': '400..700', 'Montserrat': '600..700', 'Bodoni Moda': '700..900'}
# 和文：サブセットを作る。値は読み込む太さ（style.css で使われている太さと同じ）
JP = {'Noto Sans JP': '400..700', 'Shippori Mincho': [500, 600, 700]}
SUBSET_NAME = {'Noto Sans JP': 'notosansjp', 'Shippori Mincho': 'shipporimincho'}
# 常にサブセットへ入れる文字（半角・ノーブレーク・全角スペース）
ALWAYS = '  　'
WIDTHS = [320, 375, 390, 768, 1024, 1200, 1440]
LICENSES = {'Noto Sans JP': 'notosansjp', 'Shippori Mincho': 'shipporimincho', 'Manrope': 'manrope',
            'Montserrat': 'montserrat', 'Bodoni Moda': 'bodonimoda'}


def log(*a):
    print(*a, flush=True)


def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if binary else data.decode('utf-8')


# ---------------------------------------------------------------- 対象ページとローカル表示
def pages():
    out = subprocess.run(['git', 'ls-files', '*.html'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    return ['/' + p[:-len('index.html')] if p.endswith('index.html') else '/' + p for p in out]


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=ROOT, **k)

        def log_message(self, *a):
            pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ---------------------------------------------------------------- Chrome（DevTools Protocol）
class Chrome:
    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix='dandy-fonts-')
        self.proc = subprocess.Popen([CHROME, '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
                                      '--remote-debugging-port=0', '--user-data-dir=' + self.dir, 'about:blank'],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        port_file = os.path.join(self.dir, 'DevToolsActivePort')
        for _ in range(100):
            if os.path.exists(port_file) and open(port_file).read().strip():
                break
            time.sleep(0.1)
        port = int(open(port_file).read().split()[0])
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
                break
            except Exception:
                time.sleep(0.1)
        path = [t for t in tabs if t['type'] == 'page'][0]['webSocketDebuggerUrl'].split(str(port), 1)[1]
        self.s = socket.create_connection(('127.0.0.1', port))
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.send(f'GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                    f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            buf += self.s.recv(4096)
        self.rest = buf.split(b'\r\n\r\n', 1)[1]
        self.s.settimeout(60)
        self.id = 0
        self.call('Page.enable')
        self.call('Page.bringToFront')
        self.call('Emulation.setFocusEmulationEnabled', enabled=True)

    def _send(self, obj):
        d = json.dumps(obj).encode()
        m = os.urandom(4)
        n = len(d)
        h = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack('>H', n) if n < 65536
                             else bytes([0x80 | 127]) + struct.pack('>Q', n))
        self.s.sendall(h + m + bytes(x ^ m[i % 4] for i, x in enumerate(d)))

    def _read(self, n):
        while len(self.rest) < n:
            self.rest += self.s.recv(1 << 20)
        d, self.rest = self.rest[:n], self.rest[n:]
        return d

    def _recv(self):
        msg = b''
        while True:
            b1, b2 = self._read(2)
            n = b2 & 0x7f
            if n == 126:
                n = struct.unpack('>H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._read(8))[0]
            msg += self._read(n)
            if b1 & 0x80:
                return json.loads(msg)

    def call(self, method, **params):
        self.id += 1
        self._send({'id': self.id, 'method': method, 'params': params})
        while True:
            r = self._recv()
            if r.get('id') == self.id:
                if 'error' in r:
                    raise RuntimeError(f'{method}: {r["error"]}')
                return r.get('result', {})

    def eval(self, js):
        r = self.call('Runtime.evaluate', expression=js, returnByValue=True, awaitPromise=True)
        if 'exceptionDetails' in r:
            raise RuntimeError(r['exceptionDetails'])
        return r['result'].get('value')

    def close(self):
        self.proc.kill()
        self.proc.wait()
        shutil.rmtree(self.dir, ignore_errors=True)


# 表示中のすべての文字について、font-family の並び・太さを集める（閉じたダイアログ・擬似要素・入力欄の仮表示文字を含む）
COLLECT = r"""(() => {
  const out = [];
  const add = (cs, text) => { if (text) out.push([cs.fontFamily, cs.fontWeight, text]); };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el || el.closest('script,style,noscript,template') || !n.nodeValue.trim()) continue;
    add(getComputedStyle(el), n.nodeValue);
  }
  document.querySelectorAll('[placeholder],input[value],button[value]').forEach(el => {
    add(getComputedStyle(el), (el.getAttribute('placeholder') || '') + (el.type === 'hidden' ? '' : (el.getAttribute('value') || '')));
  });
  document.querySelectorAll('*').forEach(el => {
    for (const p of ['::before', '::after', '::marker']) {
      const cs = getComputedStyle(el, p), c = cs.content;
      if (c && /^["']/.test(c)) add(cs, c.slice(1, -1).replace(/\\([0-9a-fA-F]{1,6}) ?/g, (m, h) => String.fromCodePoint(parseInt(h, 16))));
    }
  });
  return JSON.stringify(out);
})()"""


def collect_usage():
    """[(font-familyの並び, 太さ, 文字列)] を全ページ・全画面幅で集める"""
    srv = serve()
    base = f'http://127.0.0.1:{srv.server_address[1]}'
    chrome = Chrome()
    usage = []
    try:
        for path in pages():
            for w in WIDTHS:
                chrome.call('Emulation.setDeviceMetricsOverride', width=w, height=900, deviceScaleFactor=1, mobile=w < 768)
                chrome.call('Page.navigate', url=base + path)
                for _ in range(100):
                    time.sleep(0.1)
                    if chrome.eval('document.readyState') == 'complete':
                        break
                usage += json.loads(chrome.eval(COLLECT))
            log(f'  集計: {path}')
    finally:
        chrome.close()
        srv.shutdown()
    # JavaScript が表示する文言（フォームのエラー表示など）は本文の書体で表示される
    for js in subprocess.run(['git', 'ls-files', '*.js'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split():
        src = open(os.path.join(ROOT, js), encoding='utf-8').read()
        src = re.sub(r'/\*.*?\*/|//[^\n]*', '', src, flags=re.S)
        for lit in re.findall(r'"((?:[^"\\\n]|\\.)*)"|\'((?:[^\'\\\n]|\\.)*)\'', src):
            usage.append(('"Manrope", "Noto Sans JP"', '400', lit[0] or lit[1]))
    return usage


# ---------------------------------------------------------------- 文字の振り分け
def parse_ranges(ur):
    out = []
    for part in ur.split(','):
        part = part.strip()[2:]
        a, _, b = part.partition('-')
        out.append((int(a, 16), int(b or a, 16)))
    return out


def faces(css):
    """Google Fonts の CSS を @font-face ごとに分解する"""
    res = []
    for block in re.findall(r'@font-face\s*\{(.*?)\}', css, flags=re.S):
        d = dict((k.strip(), v.strip()) for k, v in (x.split(':', 1) for x in block.split(';') if ':' in x))
        d['url'] = re.search(r'url\(([^)]+)\)', d['src']).group(1)
        d['ranges'] = parse_ranges(d['unicode-range']) if 'unicode-range' in d else [(0, 0x10FFFF)]
        res.append(d)
    return res


def shippori_weight(w):
    """CSS のフォント照合と同じ規則で、指定の太さに使われる Shippori Mincho の太さを返す"""
    avail = JP['Shippori Mincho']
    if w in avail:
        return w
    if 400 <= w <= 500:
        up = [a for a in avail if w <= a <= 500]
        down = [a for a in avail if a < w]
        return min(up) if up else max(down) if down else min(a for a in avail if a > 500)
    if w < 400:
        down = [a for a in avail if a <= w]
        return max(down) if down else min(avail)
    up = [a for a in avail if a >= w]
    return min(up) if up else max(avail)


def assign(usage):
    """文字ごとに、実際に表示に使われる和文フォント（サブセットの対象）を決める。
    欧文フォント（Manrope など）が確実に持っているのは基本の英数字・記号（U+0020〜U+007E）だけとみなし、
    それ以外の文字（※ 【】 © など）は、欧文フォントにない場合に備えて次の和文フォントのサブセットにも入れる"""
    need = {'Noto Sans JP': set(ALWAYS)}
    for w in JP['Shippori Mincho']:
        need[f'Shippori Mincho {w}'] = set(ALWAYS)
    for family_list, weight, text in usage:
        stack = [f.strip().strip('"\'') for f in family_list.split(',')]
        weight = int(float(weight))
        for ch in set(text):
            if ch in '\n\r\t':
                continue
            for fam in stack:
                if fam in LATIN:
                    if 0x20 <= ord(ch) <= 0x7E:
                        break
                    continue
                if fam == 'Noto Sans JP':
                    need['Noto Sans JP'].add(ch)
                elif fam == 'Shippori Mincho':
                    need[f'Shippori Mincho {shippori_weight(weight)}'].add(ch)
                break  # それ以外（システムフォントなど）は従来どおり端末のフォントで表示
    return {k: ''.join(sorted(v)) for k, v in need.items()}


def ranges_css(chars):
    cps = sorted(ord(c) for c in chars)
    out = []
    for cp in cps:
        if out and out[-1][1] == cp - 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return ','.join(f'U+{a:X}' if a == b else f'U+{a:X}-{b:X}' for a, b in out)


# ---------------------------------------------------------------- Google Fonts からの取得
def google_css(family, wght, text=None):
    q = {'family': f'{family}:wght@{wght}', 'display': 'swap'}
    if text is not None:
        q['text'] = text
    return fetch(API + urllib.parse.urlencode(q, quote_via=urllib.parse.quote))


def local_name(url):
    # https://fonts.gstatic.com/s/notosansjp/v57/xxxx.0.woff2 → notosansjp_v57_xxxx.0.woff2
    return '_'.join(urllib.parse.urlparse(url).path.split('/')[2:])


def download_set(family, wght):
    """Google Fonts の配信ファイル一式を fonts/files/ に保存し、ローカル用の @font-face を返す"""
    css = google_css(family, wght)
    out = []
    for f in faces(css):
        name = local_name(f['url'])
        dest = os.path.join(FILES, name)
        if not os.path.exists(dest):
            open(dest, 'wb').write(fetch(f['url'], binary=True))
        rng = f" unicode-range: {f['unicode-range']};" if 'unicode-range' in f else ''
        out.append(f"@font-face{{font-family:{f['font-family']};font-style:{f['font-style']};font-weight:{f['font-weight']};"
                   f"font-display:swap;src:url(/fonts/files/{name}) format('woff2');{rng.strip()}}}")
    return out


def refresh_google():
    """欧文フォントと和文の予備フォント一式を取り直す"""
    if os.path.isdir(FILES):
        shutil.rmtree(FILES)
    os.makedirs(FILES)
    latin = []
    for fam, w in LATIN.items():
        latin += download_set(fam, w)
        log(f'  欧文フォント: {fam}')
    fallback = []
    for fam, w in JP.items():
        fallback += download_set(fam, w if isinstance(w, str) else ';'.join(map(str, w)))
        log(f'  予備フォント: {fam}')
    open(LATIN_CSS, 'w').write('\n'.join(latin) + '\n')
    open(os.path.join(FONTS, 'fonts-fallback.css'), 'w').write(
        '/* 予備フォント（自動生成：_tools/fonts/build_fonts.py）。サブセットにない文字だけを補う */\n' + '\n'.join(fallback) + '\n')
    for fam, slug in LICENSES.items():
        lic = fetch(f'https://raw.githubusercontent.com/google/fonts/main/ofl/{slug}/OFL.txt')
        open(os.path.join(FONTS, f'LICENSE-{slug}.txt'), 'w').write(lic)
    log('  ライセンス文書: OFL.txt を取得')


def build_subsets(need):
    os.makedirs(SUBSET, exist_ok=True)
    keep = set()
    out = []
    for key, chars in need.items():
        fam = 'Noto Sans JP' if key == 'Noto Sans JP' else 'Shippori Mincho'
        wght = JP[fam] if fam == 'Noto Sans JP' else key.rsplit(' ', 1)[1]
        f = faces(google_css(fam, wght, chars))
        assert len(f) == 1, f'{key}: Google Fonts の応答が想定外です'
        data = fetch(f[0]['url'], binary=True)
        name = f"{SUBSET_NAME[fam]}-{wght.replace('..', '-')}-{hashlib.sha1(data).hexdigest()[:10]}.woff2"
        open(os.path.join(SUBSET, name), 'wb').write(data)
        keep.add(name)
        weight = wght.replace('..', ' ')
        out.append(f"@font-face{{font-family:'{fam}';font-style:normal;font-weight:{weight};font-display:swap;"
                   f"src:url(/fonts/subset/{name}) format('woff2');unicode-range:{ranges_css(chars)};}}")
        log(f'  サブセット: {key}  {len(chars)}文字  {len(data) // 1024}KB  {name}')
    for old in os.listdir(SUBSET):
        if old not in keep:
            os.remove(os.path.join(SUBSET, old))
    return out


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode not in ('', '--check', '--refresh'):
        sys.exit(__doc__)
    if mode == '--refresh' or not os.path.exists(LATIN_CSS):
        if mode == '--check':
            sys.exit('_tools/fonts/latin.css がありません。先に build_fonts.py を実行してください。')
        log('Google Fonts から欧文フォント・予備フォントを取得しています…')
        refresh_google()
    log('サイトで使われている文字を集計しています…')
    need = assign(collect_usage())
    if mode == '--check':
        have = json.load(open(STATE, encoding='utf-8')) if os.path.exists(STATE) else {}
        missing = {k: ''.join(sorted(set(v) - set(have.get(k, '')))) for k, v in need.items()}
        missing = {k: v for k, v in missing.items() if v}
        if not missing:
            log('OK：サブセットに足りない文字はありません。')
            return
        for k, v in missing.items():
            log(f'  {k}: {len(v)}文字  {v}')
        log('サブセットにない文字があります（表示は予備フォントで補われます）。'
            '速度を保つには build_fonts.py を実行してください。')
        sys.exit(1)
    log('サブセットを作成しています…')
    subset_faces = build_subsets(need)
    css = ('/* Webフォント（自動生成：_tools/fonts/build_fonts.py。手で編集しない） */\n'
           + open(LATIN_CSS).read() + '\n'.join(subset_faces) + '\n')
    open(os.path.join(FONTS, 'fonts.css'), 'w').write(css)
    json.dump(need, open(STATE, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
    log('完了：fonts/fonts.css を更新しました。表示を確認してから commit してください。')


if __name__ == '__main__':
    main()
