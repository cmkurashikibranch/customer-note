# お客様ノート ステップ3（AI自動読取・GAS経由）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 名刺写真を Claude（Haiku・Vision）で自動読取し各欄へ振り分ける機能を、APIキー保護のためGAS中継経由で `customer-note.html` に追加する。

**Architecture:** GitHub Pages（公開・単一HTML）→ `fetch`(text/plain, body=JSON) → GAS Web App（APIキーはScript Propertiesのみ・1日上限・合言葉・画像サイズ上限）→ Claude API（`claude-haiku-4-5`・構造化出力）。結果 `{name,company,phone,email,memo}` はステップ2と同形で、反映関数を共通化して再利用。設定URLは公開コードに書かず、設定画面/QR(#cfg=ハッシュ)で受け渡す。

**Tech Stack:** Vanilla HTML/CSS/JS、Google Apps Script（`UrlFetchApp`/`PropertiesService`/`LockService`/`ContentService`）、`node:test`（純関数の単体テスト）、ブラウザ（UI確認）。

**作業ディレクトリ:** `C:\Users\kkmh2\claude\名刺顧客管理`

**設計書:** `docs/superpowers/specs/2026-06-13-customer-note-step3-ai-design.md`

---

## File Structure

| ファイル | 責務 |
|---------|------|
| `gas/Code.gs` | GAS中継。純関数ブロック（`/* PURE:START */…END */`）＋`doPost`オーケストレーション＋`testProxy`。キーはScript Properties。 |
| `tests/gas-helpers.test.js` | `gas/Code.gs` のPUREブロックをNodeで抽出して単体テスト（dataURL解析・バイト数・ペイロード・応答分類）。 |
| `customer-note.html` | 設定画面 `#view-settings`／設定ハッシュ受信（`/* CFGHASH:START */…END */`）／🤖AIボタン＋`runAiRead`／共通反映 `applyParsed`／推測・要確認タグ。既存ロジックは原則不変。 |
| `tests/config-hash.test.js` | `customer-note.html` のCFGHASHブロックを抽出して単体テスト（`b64urlEncode`/`parseConfigHash`）。 |
| `docs/setup-guide-step3.md` | GAS作成・キー登録・デプロイ・設定貼り付けの手順書（Task 7）。 |
| `index.html` | `customer-note.html` のコピー（公開エントリ・Task 7で同期）。 |

実行順：**Task 0でCORS疎通を先に確認** → GAS（純関数TDD→doPost）→ クライアント（設定→共通反映→AIボタン）→ テスト/E2E → 同期・手順書 →（任意）QR。

テスト実行：`node --test tests/gas-helpers.test.js` / `node --test tests/config-hash.test.js`（ディレクトリ指定はMODULE_NOT_FOUNDになる環境のため**ファイル直接指定**）。コミットに `Co-Authored-By` は付けない（リポジトリ既存スタイル）。

---

### Task 0: CORS疎通PoC（最初のゲート・コミット無し）

**目的:** GitHub Pages → GAS Web App の `fetch` が通るか実機確認する。**通らなければ設計を見直す。**

**Files:** なし（使い捨ての最小GASを手動デプロイ）

- [ ] **Step 1: 最小GASをデプロイ**

GASエディタで新規プロジェクトを作り、次を貼り付けて Web App（「自分として実行」「アクセスできるユーザー: 全員」）でデプロイし、`/exec` URL を控える。

```javascript
function doPost(e) {
  var body = (e && e.postData) ? e.postData.contents : null;
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, echo: body }))
    .setMimeType(ContentService.MimeType.JSON);
}
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, ping: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 2: 公開オリジンから叩いて確認**

公開済み `https://cmkurashikibranch.github.io/customer-note/` を開き、DevToolsのConsoleで（`<EXEC_URL>` を置換）：

```js
fetch('<EXEC_URL>', { method: 'POST', body: JSON.stringify({ hello: 'world' }) })
  .then(r => r.json()).then(j => console.log('RESULT', j))
  .catch(e => console.error('FAILED', e));
```

Expected:
- Console に `RESULT {ok:true, echo:"{\"hello\":\"world\"}"}`
- Network タブで **OPTIONS（プリフライト）が出ていない**こと、`/exec` が 302 → `script.googleusercontent.com` を追従して 200 本文が取れること

- [ ] **Step 3: 結果を記録**

通れば本実装へ進む。CORSで弾かれる/プリフライトが出る場合は、`headers`/`mode` を付けていないか確認し、それでもダメなら設計の通信方式を再検討（このタスクで止める）。コミットは不要（外部GAS・使い捨て）。

---

### Task 1: GAS純関数（dataURL解析・バイト数・ペイロード・応答分類）をTDD

**Files:**
- Create: `gas/Code.gs`
- Create: `tests/gas-helpers.test.js`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/gas-helpers.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function loadPure() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');
  const m = src.match(/\/\* PURE:START \*\/([\s\S]*?)\/\* PURE:END \*\//);
  if (!m) throw new Error('PURE block not found in gas/Code.gs');
  const mod = { exports: {} };
  new Function('module', 'exports', m[1])(mod, mod.exports);
  return mod.exports;
}
const { parseDataUrl, approxBytesFromBase64, buildClaudePayload, classifyClaudeResponse } = loadPure();

test('parseDataUrl: jpeg を mediaType と base64 に分解', () => {
  assert.deepStrictEqual(parseDataUrl('data:image/jpeg;base64,AAAB'), { mediaType: 'image/jpeg', base64: 'AAAB' });
});
test('parseDataUrl: png も分解', () => {
  assert.strictEqual(parseDataUrl('data:image/png;base64,ZZ').mediaType, 'image/png');
});
test('parseDataUrl: dataURLでなければ null', () => {
  assert.strictEqual(parseDataUrl('hello'), null);
  assert.strictEqual(parseDataUrl(''), null);
  assert.strictEqual(parseDataUrl(null), null);
});

test('approxBytesFromBase64: パディング無し', () => {
  assert.strictEqual(approxBytesFromBase64('AAAA'), 3); // 4文字→3バイト
});
test('approxBytesFromBase64: パディング1/2', () => {
  assert.strictEqual(approxBytesFromBase64('AAA='), 2);
  assert.strictEqual(approxBytesFromBase64('AA=='), 1);
});
test('approxBytesFromBase64: 空は0', () => {
  assert.strictEqual(approxBytesFromBase64(''), 0);
});

test('buildClaudePayload: 画像とスキーマを含む', () => {
  const p = buildClaudePayload('claude-haiku-4-5', 1024, 'image/jpeg', 'XYZ');
  assert.strictEqual(p.model, 'claude-haiku-4-5');
  assert.strictEqual(p.max_tokens, 1024);
  const img = p.messages[0].content.find(c => c.type === 'image');
  assert.strictEqual(img.source.media_type, 'image/jpeg');
  assert.strictEqual(img.source.data, 'XYZ');
  const schema = p.output_config.format.schema;
  assert.deepStrictEqual(schema.required, ['name','company','phone','email','memo']);
  assert.strictEqual(schema.additionalProperties, false);
});

test('classifyClaudeResponse: 200＋正常JSON → ok+data', () => {
  const body = JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"name":"山田太郎","company":"山田工務店","phone":"086-426-1111","email":"a@b.jp","memo":"役職：代表"}' }] });
  const r = classifyClaudeResponse(200, body);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.name, '山田太郎');
  assert.strictEqual(r.data.memo, '役職：代表');
});
test('classifyClaudeResponse: 欠けた項目は空文字で補完', () => {
  const body = JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"name":"山田"}' }] });
  const r = classifyClaudeResponse(200, body);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.company, '');
  assert.strictEqual(r.data.email, '');
});
test('classifyClaudeResponse: refusal → error refusal', () => {
  const r = classifyClaudeResponse(200, JSON.stringify({ stop_reason: 'refusal', content: [] }));
  assert.deepStrictEqual(r, { ok: false, error: 'refusal' });
});
test('classifyClaudeResponse: max_tokens → error upstream', () => {
  const r = classifyClaudeResponse(200, JSON.stringify({ stop_reason: 'max_tokens', content: [] }));
  assert.deepStrictEqual(r, { ok: false, error: 'upstream' });
});
test('classifyClaudeResponse: 本文が壊れたJSON → error parse', () => {
  const r = classifyClaudeResponse(200, JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{壊れ' }] }));
  assert.deepStrictEqual(r, { ok: false, error: 'parse' });
});
test('classifyClaudeResponse: 401 → auth, 429/500 → upstream', () => {
  assert.strictEqual(classifyClaudeResponse(401, '').error, 'auth');
  assert.strictEqual(classifyClaudeResponse(429, '').error, 'upstream');
  assert.strictEqual(classifyClaudeResponse(500, '').error, 'upstream');
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/gas-helpers.test.js`
Expected: FAIL（`PURE block not found in gas/Code.gs`）

- [ ] **Step 3: PUREブロックを実装**

Create `gas/Code.gs`（このタスクではPUREブロックのみ。`doPost`等はTask 2で追記）：

```javascript
/* PURE:START */
// GASグローバル（UrlFetchApp等）を一切参照しない自己完結ブロック。Nodeでテストする。
function parseDataUrl(dataUrl) {
  var m = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl == null ? '' : dataUrl));
  if (!m) return null;
  return { mediaType: m[1], base64: m[2] };
}

function approxBytesFromBase64(b64) {
  b64 = String(b64 == null ? '' : b64);
  var len = b64.length;
  if (len === 0) return 0;
  var pad = b64.charAt(len - 1) === '=' ? (b64.charAt(len - 2) === '=' ? 2 : 1) : 0;
  return Math.floor(len * 3 / 4) - pad;
}

function buildClaudePayload(model, maxTokens, mediaType, base64) {
  return {
    model: model,
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'この名刺画像から name(氏名) / company(会社名・屋号) / phone(電話番号・番号のみ) / email / memo(役職・住所・FAX等の補足) を抽出してJSONで返してください。読み取れない項目は空文字。電話とFAXが両方あれば電話をphone、FAXはmemoへ。' }
      ]
    }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            name:    { type: 'string', description: '氏名' },
            company: { type: 'string', description: '会社名・屋号' },
            phone:   { type: 'string', description: '電話番号（番号のみ）' },
            email:   { type: 'string', description: 'メールアドレス' },
            memo:    { type: 'string', description: '役職・住所・FAXなど補足' }
          },
          required: ['name', 'company', 'phone', 'email', 'memo'],
          additionalProperties: false
        }
      }
    }
  };
}

function classifyClaudeResponse(httpCode, bodyText) {
  if (httpCode === 401 || httpCode === 403) return { ok: false, error: 'auth' };
  if (httpCode === 429 || httpCode === 529 || httpCode >= 500) return { ok: false, error: 'upstream' };
  if (httpCode !== 200) return { ok: false, error: 'upstream' };
  var body;
  try { body = JSON.parse(bodyText); } catch (e) { return { ok: false, error: 'parse' }; }
  if (body.stop_reason === 'refusal') return { ok: false, error: 'refusal' };
  if (body.stop_reason === 'max_tokens') return { ok: false, error: 'upstream' };
  var blocks = body.content || [];
  var textBlock = null;
  for (var i = 0; i < blocks.length; i++) { if (blocks[i].type === 'text' && blocks[i].text) { textBlock = blocks[i]; break; } }
  if (!textBlock) return { ok: false, error: 'parse' };
  var data;
  try { data = JSON.parse(textBlock.text); } catch (e) { return { ok: false, error: 'parse' }; }
  var keys = ['name', 'company', 'phone', 'email', 'memo'];
  var out = {};
  for (var k = 0; k < keys.length; k++) { out[keys[k]] = typeof data[keys[k]] === 'string' ? data[keys[k]] : ''; }
  return { ok: true, data: out };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseDataUrl: parseDataUrl, approxBytesFromBase64: approxBytesFromBase64, buildClaudePayload: buildClaudePayload, classifyClaudeResponse: classifyClaudeResponse };
}
/* PURE:END */
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `node --test tests/gas-helpers.test.js`
Expected: PASS（全テスト）

- [ ] **Step 5: Commit**

```bash
git add gas/Code.gs tests/gas-helpers.test.js
git commit -m "feat(step3): GAS純関数（dataURL解析/バイト数/ペイロード/応答分類）＋テスト"
```

---

### Task 2: GAS doPost オーケストレーション ＋ testProxy

**Files:**
- Modify: `gas/Code.gs`（PUREブロックの**後ろ**に追記）

- [ ] **Step 1: CONFIG・doPost・補助関数を追記**

`gas/Code.gs` の `/* PURE:END */` の**次の行**以降に追記：

```javascript

// ===== 設定（モデル・上限はここだけ変更すればよい） =====
var CONFIG = {
  model: 'claude-haiku-4-5',          // 精度不足なら 'claude-sonnet-4-6' 等に変更
  maxTokens: 1024,
  maxPerDay: 50,                      // 1日の読取上限（枚）
  maxImageBytes: 1.5 * 1024 * 1024,   // 画像バイト上限（巨大画像を弾く）
  anthropicVersion: '2023-06-01'
};

function props_() { return PropertiesService.getScriptProperties(); }

function countKey_() {
  return 'count_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}
function count_() { return Number(props_().getProperty(countKey_()) || 0); }
function setCount_(n) { props_().setProperty(countKey_(), String(n)); }
function remaining_() { return Math.max(0, CONFIG.maxPerDay - count_()); }

function doPost(e) {
  var res = handle_(e);
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return { ok: false, error: 'parse' }; }

  // 合言葉トークン照合（URL秘匿に加える第2の関門）
  if (!body || body.secret !== props_().getProperty('APP_SECRET')) return { ok: false, error: 'auth' };

  // 疎通ping（Claudeを呼ばない＝無料）
  if (body.action === 'ping') return { ok: true, remaining: remaining_() };

  // 画像チェック
  var parsed = parseDataUrl(body.image);
  if (!parsed) return { ok: false, error: 'bad_image' };
  if (approxBytesFromBase64(parsed.base64) > CONFIG.maxImageBytes) return { ok: false, error: 'bad_image' };

  // 1日上限（read-modify-writeをロックで保護）
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var n = count_();
    if (n >= CONFIG.maxPerDay) return { ok: false, error: 'limit' };
    setCount_(n + 1);
  } finally {
    lock.releaseLock();
  }

  // Claude API へ中継
  var payload = buildClaudePayload(CONFIG.model, CONFIG.maxTokens, parsed.mediaType, parsed.base64);
  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': props_().getProperty('ANTHROPIC_API_KEY'),
      'anthropic-version': CONFIG.anthropicVersion
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var result = classifyClaudeResponse(resp.getResponseCode(), resp.getContentText());
  if (result.ok) result.remaining = remaining_();
  return result;
}

// GASエディタから手動実行する結線テスト
function testProxy() {
  // ↓実際の名刺写真の dataURL（"data:image/jpeg;base64,...."）を貼り付けて実行
  var SAMPLE = 'data:image/jpeg;base64,REPLACE_WITH_REAL_CARD_BASE64';
  var fake = { postData: { contents: JSON.stringify({ image: SAMPLE, secret: props_().getProperty('APP_SECRET') }) } };
  Logger.log(JSON.stringify(handle_(fake)));
}
```

- [ ] **Step 2: Script Properties を登録（GASエディタ）**

GASエディタ → プロジェクトの設定 → スクリプト プロパティ：
- `ANTHROPIC_API_KEY` = あなたのAnthropic APIキー
- `APP_SECRET` = 任意の合言葉（例：英数16文字）

- [ ] **Step 3: testProxy で結線確認**

`testProxy()` の `SAMPLE` を実際の名刺写真の dataURL に差し替えて実行 → 実行ログに `{"ok":true,"data":{...},"remaining":...}` が出ること。`output_config.format` が `claude-haiku-4-5` で効くこと・初回コンパイル遅延も体感確認。
※dataURLは、ブラウザのConsoleで `regPhotoData`（撮影後）を `copy(regPhotoData)` などで取得すると作れる。

- [ ] **Step 4: Web App をデプロイ**

「デプロイ → 新しいデプロイ → 種類: ウェブアプリ」「自分として実行」「アクセスできるユーザー: 全員」でデプロイ → `/exec` URL を控える（Task 3の設定で使う）。

- [ ] **Step 5: Commit**

```bash
git add gas/Code.gs
git commit -m "feat(step3): GAS doPost（secret照合/画像上限/日次ロック/Claude中継/エラー正規化）＋testProxy"
```

---

### Task 3: クライアント — 設定画面＋設定ハッシュ受信（parseConfigHash TDD）

**Files:**
- Modify: `customer-note.html`
- Create: `tests/config-hash.test.js`

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/config-hash.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function loadCfg() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'customer-note.html'), 'utf8');
  const m = html.match(/\/\* CFGHASH:START \*\/([\s\S]*?)\/\* CFGHASH:END \*\//);
  if (!m) throw new Error('CFGHASH block not found in customer-note.html');
  const mod = { exports: {} };
  new Function('module', 'exports', m[1])(mod, mod.exports);
  return mod.exports;
}
const { b64urlEncode, parseConfigHash } = loadCfg();

test('encode→parse で往復できる', () => {
  const link = '#cfg=' + b64urlEncode(JSON.stringify({ u: 'https://x/exec', s: 'secret123' }));
  assert.deepStrictEqual(parseConfigHash(link), { endpoint: 'https://x/exec', secret: 'secret123' });
});
test('日本語を含む合言葉でも往復できる', () => {
  const link = '#cfg=' + b64urlEncode(JSON.stringify({ u: 'https://x/exec', s: 'あいことば' }));
  assert.strictEqual(parseConfigHash(link).secret, 'あいことば');
});
test('cfg以外のハッシュ・空は null', () => {
  assert.strictEqual(parseConfigHash('#other'), null);
  assert.strictEqual(parseConfigHash(''), null);
  assert.strictEqual(parseConfigHash(null), null);
});
test('壊れたcfgは null（例外を投げない）', () => {
  assert.strictEqual(parseConfigHash('#cfg=%%%notbase64%%%'), null);
});
test('u/sが揃わなければ null', () => {
  const link = '#cfg=' + b64urlEncode(JSON.stringify({ u: 'https://x/exec' }));
  assert.strictEqual(parseConfigHash(link), null);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/config-hash.test.js`
Expected: FAIL（`CFGHASH block not found`）

- [ ] **Step 3: CFGHASHブロックを実装**

Edit: `customer-note.html` の行 `function setGuess(fieldId, on) {` の**直前**に次を挿入（検索文字列 `function setGuess(fieldId, on) {` を、下記＋空行＋`function setGuess(fieldId, on) {` に置換）：

```javascript
/* CFGHASH:START */
function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function parseConfigHash(hash) {
  var m = /^#cfg=(.+)$/.exec(String(hash == null ? '' : hash));
  if (!m) return null;
  try {
    var b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var o = JSON.parse(decodeURIComponent(escape(atob(b64))));
    if (o && typeof o.u === 'string' && typeof o.s === 'string') return { endpoint: o.u, secret: o.s };
    return null;
  } catch (e) { return null; }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { b64urlEncode: b64urlEncode, parseConfigHash: parseConfigHash };
/* CFGHASH:END */
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `node --test tests/config-hash.test.js`
Expected: PASS（5テスト）

- [ ] **Step 5: `DEFAULT_DATA.settings` に既定値を追加**

Edit: 行 `  settings: { followUpDays: 14 },` を次に置換：

```javascript
  settings: { followUpDays: 14, aiEndpoint: '', aiSecret: '', aiConsent: false },
```

- [ ] **Step 6: ホームヘッダーに⚙️を追加**

Edit: 行 `  <h1>お客様ノート</h1>`（`#view-home` 内）を次に置換：

```html
  <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
    <h1 style="margin:0;">お客様ノート</h1>
    <span class="back-link" style="margin:0; font-size:22px;" role="button" aria-label="設定" title="設定" onclick="showView('settings')">⚙️</span>
  </div>
```

- [ ] **Step 7: 設定画面 `#view-settings` を追加**

Edit: `#view-home` の閉じ `</div>`（行 `</div>` の直後が `<div id="view-register"` になっている箇所）と `<div id="view-register" class="view">` の間に、次のビューを挿入する。検索文字列：

```html
<div id="view-register" class="view">
```

を次に置換（前に設定ビューを差し込む）：

```html
<div id="view-settings" class="view">
  <span class="back-link" onclick="showView('home')">← もどる</span>
  <h1>設定</h1>
  <div class="card">
    <label class="field-label">AI読み取りサーバーURL</label>
    <textarea id="set-endpoint" class="field-input" rows="2" placeholder="https://script.google.com/macros/s/.../exec" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
    <label class="field-label">合言葉（サーバーと同じもの）</label>
    <input type="text" id="set-secret" class="field-input" autocapitalize="off" autocomplete="off" spellcheck="false">
    <div class="paste-actions">
      <button class="btn btn-sm" onclick="saveAiSettings()">保存して接続確認</button>
      <button class="btn btn-ghost btn-sm" onclick="copySetupLink()">設定リンクをコピー</button>
    </div>
    <div id="set-status" aria-live="polite" style="margin-top:8px; font-size:13px; min-height:1.2em;"></div>
    <div id="set-remaining" style="margin-top:6px; font-size:12px; color:var(--text-2);"></div>
  </div>
  <div class="card" style="font-size:12px; color:var(--text-2); line-height:1.7;">
    AI読み取りは、名刺の写真をあなた専用サーバー経由でAIに送り、各欄を自動入力します（写真の保存はこの端末だけ）。<br>
    「設定リンクをコピー」で作ったリンクをQRにして渡すと、相手は読み込むだけで設定完了します。
  </div>
</div>
<div id="view-register" class="view">
```

- [ ] **Step 8: 設定保存・接続確認・リンクコピー・ハッシュ受信の関数を追加**

Edit: 行 `function showView(name) {` の**直前**に次を挿入（検索文字列 `function showView(name) {` を、下記＋空行＋`function showView(name) {` に置換）：

```javascript
function aiErrorMessage(error) {
  switch (error) {
    case 'auth':      return 'サーバー側の設定（合言葉）をご確認ください';
    case 'bad_image': return '画像が大きすぎます。撮り直すか手入力をどうぞ';
    case 'limit':     return '本日のAI読み取り上限に達しました（明日0時JSTにリセット）';
    case 'refusal':   return '自動で読み取れませんでした。手入力かOCRをどうぞ';
    case 'upstream':  return 'AIが混み合っています。少し待つか手入力をどうぞ';
    case 'parse':     return '読み取り結果を取得できませんでした。手入力をどうぞ';
    default:          return 'うまくいきませんでした。手入力かOCRをどうぞ';
  }
}

function showRemaining(n) {
  const el = document.getElementById('set-remaining');
  el.textContent = (typeof n === 'number') ? ('本日あと ' + n + ' 枚（明日0時JSTにリセット）') : '';
}

async function saveAiSettings() {
  const ep = document.getElementById('set-endpoint').value.trim().replace(/\s+/g, '');
  const sec = document.getElementById('set-secret').value.trim();
  appData.settings.aiEndpoint = ep;
  appData.settings.aiSecret = sec;
  saveData();
  const st = document.getElementById('set-status');
  if (!ep) { st.textContent = ''; showRemaining(null); return; }
  st.style.color = 'var(--text-2)'; st.textContent = '接続を確認しています…';
  try {
    const r = await fetch(ep, { method: 'POST', body: JSON.stringify({ action: 'ping', secret: sec }) });
    const j = await r.json();
    if (j && j.ok) { st.style.color = 'var(--accent)'; st.textContent = '✅ つながりました'; showRemaining(j.remaining); }
    else { st.style.color = '#DC2626'; st.textContent = '✗ ' + aiErrorMessage(j && j.error); }
  } catch (e) {
    st.style.color = '#DC2626'; st.textContent = '✗ つながりません（URL・合言葉をご確認ください）';
  }
}

function copySetupLink() {
  const link = location.origin + location.pathname + '#cfg=' + b64urlEncode(JSON.stringify({ u: appData.settings.aiEndpoint, s: appData.settings.aiSecret }));
  const st = document.getElementById('set-status');
  navigator.clipboard.writeText(link).then(() => {
    st.style.color = 'var(--accent)'; st.textContent = '設定リンクをコピーしました。QRにして相手に渡せます';
  }, () => {
    st.style.color = '#DC2626'; st.textContent = 'コピーできませんでした';
  });
}

function syncSettingsForm() {
  document.getElementById('set-endpoint').value = appData.settings.aiEndpoint || '';
  document.getElementById('set-secret').value = appData.settings.aiSecret || '';
  document.getElementById('set-status').textContent = '';
  showRemaining(null);
}

```

- [ ] **Step 9: 設定画面を開くときにフォームを同期**

Edit: 行 `function showView(name) {` の本体を次に置換（`showView` 全体を差し替え）：

```javascript
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  if (name === 'settings') syncSettingsForm();
  window.scrollTo(0, 0);
}
```

- [ ] **Step 10: 起動時にハッシュ設定を取り込む**

Edit: 行 `appData = loadData();` を次に置換：

```javascript
appData = loadData();
(function applyHashConfig() {
  const cfg = parseConfigHash(location.hash);
  if (cfg) {
    appData.settings.aiEndpoint = cfg.endpoint;
    appData.settings.aiSecret = cfg.secret;
    appData.settings.aiConsent = false;
    saveData();
    history.replaceState(null, '', location.pathname + location.search);
    alert('✅ AI読み取りの設定が完了しました');
  }
})();
```

- [ ] **Step 11: ブラウザで確認（ローカルHTTP経由）**

1. ⚙️→設定画面。URL・合言葉を入れ「保存して接続確認」→ Task 2のGASに対し「✅ つながりました」＋残り枚数（誤URLなら「✗ つながりません」）。
2. 「設定リンクをコピー」→ クリップボードに `…#cfg=…` が入る。
3. そのリンクを別タブで開く→「✅ AI読み取りの設定が完了しました」が出て、URLからhashが消える。設定画面に値が入っている。

- [ ] **Step 12: Commit**

```bash
git add customer-note.html tests/config-hash.test.js
git commit -m "feat(step3): 設定画面＋設定ハッシュ受信（QR/リンク）＋疎通ping"
```

---

### Task 4: 共通反映 `applyParsed` ＋ runParse 合流 ＋ 電話/メール要確認タグ

**Files:**
- Modify: `customer-note.html`

- [ ] **Step 1: 電話・メール入力欄に要確認タグを追加**

Edit: 行 `    <input type="tel" id="reg-phone" class="field-input">` を次に置換：

```html
    <input type="tel" id="reg-phone" class="field-input"><span id="reg-phone-guess" class="guess-tag">要確認</span>
```

Edit: 行 `    <input type="email" id="reg-email" class="field-input">` を次に置換：

```html
    <input type="email" id="reg-email" class="field-input"><span id="reg-email-guess" class="guess-tag">要確認</span>
```

- [ ] **Step 2: 共通反映関数 `applyParsed` を追加**

Edit: 行 `function setGuess(fieldId, on) {` の**直前**に次を挿入（検索文字列 `function setGuess(fieldId, on) {` を、下記＋空行＋`function setGuess(fieldId, on) {` に置換）：

```javascript
function applyParsed(p, source) {
  const isAi = source === 'ai';
  if (p.name)    { document.getElementById('reg-name').value = p.name; setGuess('reg-name', true); }
  if (p.company) { document.getElementById('reg-company').value = p.company; setGuess('reg-company', true); }
  if (p.phone)   { document.getElementById('reg-phone').value = p.phone; if (isAi) setGuess('reg-phone', true); }
  if (p.email)   { document.getElementById('reg-email').value = p.email; if (isAi) setGuess('reg-email', true); }
  if (p.memo) {
    const note = document.getElementById('reg-note');
    const existing = note.value.split('\n').map(s => s.trim()).filter(Boolean);
    p.memo.split('\n').map(s => s.trim()).filter(Boolean)
      .forEach(line => { if (!existing.includes(line)) existing.push(line); });
    note.value = existing.join('\n');
  }
  let msg;
  if (isAi) {
    msg = '✨ AIが読み取りました。お名前・会社・電話・メールは念のためご確認ください';
  } else {
    msg = '✨ 読み取りました。電話とメールはそのまま、お名前と会社は念のため確認してくださいね';
    if (!p.phone && !p.email) msg += '\n（電話・メールは見つかりませんでした。手で入れてくださいね）';
  }
  if (!p.name) msg += '\n（お名前は読み取れませんでした。上の欄にご記入を）';
  const st = document.getElementById('reg-paste-status');
  st.textContent = msg; st.style.display = 'block';
}

```

- [ ] **Step 3: `runParse` を `applyParsed` 経由に変更**

Edit: `runParse` 関数全体（`function runParse() {` 〜 対応する `}`）を次に置換：

```javascript
function runParse() {
  const ta = document.getElementById('reg-paste');
  if (!ta.value.trim()) { alert('貼り付け欄が空です'); return; }
  const ids = ['reg-name','reg-company','reg-phone','reg-email','reg-note'];
  const hasContent = ids.some(id => document.getElementById(id).value.trim());
  if (hasContent && !confirm('入力済みの内容を読み取り結果で置き換えますか？')) return;
  applyParsed(parseCard(ta.value), 'ocr');
}
```

- [ ] **Step 4: `clearPaste` で電話・メールの要確認タグも消す**

Edit: `clearPaste` 内の行 `  setGuess('reg-name', false); setGuess('reg-company', false);` を次に置換：

```javascript
  ['reg-name','reg-company','reg-phone','reg-email'].forEach(id => setGuess(id, false));
```

- [ ] **Step 5: `resetRegisterForm` で電話・メールの要確認タグも消す**

Edit: `resetRegisterForm` 内の行 `  setGuess('reg-name', false); setGuess('reg-company', false);` を次に置換：

```javascript
  ['reg-name','reg-company','reg-phone','reg-email'].forEach(id => setGuess(id, false));
```

- [ ] **Step 6: 編集で要確認タグが外れる対象に電話・メールを追加**

Edit: 行 `['reg-name','reg-company'].forEach(id => {` を次に置換：

```javascript
['reg-name','reg-company','reg-phone','reg-email'].forEach(id => {
```

- [ ] **Step 7: 既存テスト＋ブラウザで確認**

Run: `node --test tests/parse-card.test.js`（ステップ2の24/24が維持されること）
ブラウザ：OCR貼り付け→読み取る→従来どおり（名前・会社に「推測」、電話・メールはタグ無し）。クリアで全タグ消える。

- [ ] **Step 8: Commit**

```bash
git add customer-note.html
git commit -m "feat(step3): 反映を applyParsed に共通化＋電話/メール要確認タグ（OCR挙動は不変）"
```

---

### Task 5: 🤖AIボタン ＋ runAiRead（ローディング/20秒タイムアウト/完了フラッシュ/各ガード）＋ OCRを格下げ

**Files:**
- Modify: `customer-note.html`

- [ ] **Step 1: CSS（AIボタン・スピナー・フラッシュ）を追加**

Edit: 行 `  .guess-tag.on { display:inline; }` を次に置換（直後にスタイル追加）：

```css
  .guess-tag.on { display:inline; }
  #reg-ai-wrap { display:none; margin-bottom:10px; }
  .btn-ai { width:100%; background:var(--accent); }
  .btn-ai:disabled { opacity:0.7; }
  .ai-sub { font-size:11px; color:var(--text-2); text-align:center; margin-top:4px; }
  @keyframes flashbg { 0% { background:#FEF9C3; } 100% { background:#FBFCFE; } }
  .field-input.flash { animation: flashbg 0.6s ease-out; }
  .ocr-details { margin-bottom:10px; }
  .ocr-details > summary { cursor:pointer; font-size:13px; color:var(--text-2); padding:6px 0; }
```

- [ ] **Step 2: 写真カードの下に🤖AIボタンを差し込む**

Edit: 写真カードの閉じ（`#view-register` 内、`reg-photo-input` を含む `.card` の閉じ `</div>`）の直後に挿入する。検索文字列：

```html
      <input type="file" id="reg-photo-input" accept="image/*" capture="environment" style="display:none;">
    </label>
  </div>
```

を次に置換：

```html
      <input type="file" id="reg-photo-input" accept="image/*" capture="environment" style="display:none;">
    </label>
  </div>
  <div id="reg-ai-wrap">
    <button class="btn btn-ai" id="reg-ai-btn" onclick="runAiRead()">🤖 AIで読み取る</button>
    <div class="ai-sub">約0.3円／枚・数秒かかります</div>
  </div>
```

- [ ] **Step 3: OCR貼り付けカードを `<details>` に格下げ**

Edit: OCR貼り付けカードの開始行 `  <div class="card">`（`reg-paste` を含むカード。`<label class="field-label">名刺の文字を貼り付け…` の直前の `<div class="card">`）を次に置換：

```html
  <details class="card ocr-details">
    <summary>うまく撮れない時：名刺の文字を貼り付けて読み取る</summary>
```

そして同カードの閉じ `</div>`（`paste-help` の `</details>` の直後の `</div>`）を次に置換：

```html
  </details>
```

※ `.card`（写真）→ `#reg-ai-wrap` → `<details class="card">`（OCR）→ `.card`（名前等）の順に開閉が揃うことを確認（開きタグを `<div class="card">`→`<details ...>`、閉じタグを `</div>`→`</details>` に1対1で置換しているので数は不変）。

- [ ] **Step 4: AI読み取りハンドラ群を追加**

Edit: 行 `function applyParsed(p, source) {` の**直前**に次を挿入（検索文字列 `function applyParsed(p, source) {` を、下記＋空行＋`function applyParsed(p, source) {` に置換）：

```javascript
let aiBusy = false;

function showAiStatus(msg) {
  const st = document.getElementById('reg-paste-status');
  st.textContent = msg; st.style.display = 'block';
}

function flashFields(ids) {
  ids.forEach((id, i) => {
    const el = document.getElementById(id);
    setTimeout(() => {
      el.classList.remove('flash');
      void el.offsetWidth; // reflow でアニメ再起動
      el.classList.add('flash');
    }, i * 300);
  });
}

async function runAiRead() {
  if (aiBusy) return;
  if (regPhotoBusy) { alert('写真を処理中です。少し待ってからもう一度押してください。'); return; }
  if (!regPhotoData) { alert('先に名刺の写真を撮ってください'); return; }
  if (!navigator.onLine) { showAiStatus('オフラインです。手入力かOCRをお使いください'); return; }
  const ep = appData.settings.aiEndpoint, sec = appData.settings.aiSecret;
  if (!ep) { if (confirm('AI読み取りの設定がありません。設定を開きますか？')) showView('settings'); return; }
  const ids = ['reg-name','reg-company','reg-phone','reg-email','reg-note'];
  if (ids.some(id => document.getElementById(id).value.trim()) &&
      !confirm('入力済みの内容を読み取り結果で置き換えますか？（手で直した所も置き換わります）')) return;
  if (!appData.settings.aiConsent) {
    if (!confirm('名刺の写真をAIに送って読み取ります（写真の保存はこの端末だけ）。よろしいですか？')) return;
    appData.settings.aiConsent = true; saveData();
  }

  aiBusy = true;
  const btn = document.getElementById('reg-ai-btn');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ 読み取り中…（数秒かかります）';
  showAiStatus('🤖 AIが名刺を読んでいます…');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(ep, { method: 'POST', body: JSON.stringify({ image: regPhotoData, secret: sec }), signal: ctrl.signal });
    const j = await r.json();
    if (j && j.ok) {
      applyParsed(j.data, 'ai');
      flashFields(['reg-name','reg-company','reg-phone','reg-email'].filter(id => document.getElementById(id).value.trim()));
    } else {
      showAiStatus(aiErrorMessage(j && j.error));
    }
  } catch (err) {
    showAiStatus(err && err.name === 'AbortError'
      ? '時間がかかっています。手入力かOCRに切り替えてください'
      : 'つながりません。手入力かOCRをお使いください');
  } finally {
    clearTimeout(timer); aiBusy = false; btn.disabled = false; btn.textContent = orig;
  }
}

```

- [ ] **Step 5: 写真の有無でAIボタンの表示を切り替える**

写真処理リスナー（`reg-photo-input` の `change`）で、成功時に `#reg-ai-wrap` を表示、失敗時に非表示にする。

Edit: 行 `    regPhotoData = dataUrl;` を次に置換：

```javascript
    regPhotoData = dataUrl;
    document.getElementById('reg-ai-wrap').style.display = navigator.onLine ? 'block' : 'none';
```

Edit: 失敗側の行 `    regPhotoData = null;`（`reg-photo-input` リスナー内）を次に置換：

```javascript
    regPhotoData = null;
    document.getElementById('reg-ai-wrap').style.display = 'none';
```

- [ ] **Step 6: フォームリセットでAIボタンを隠す**

Edit: `resetRegisterForm` 内の行 `  regPhotoData = null;` を次に置換：

```javascript
  regPhotoData = null;
  const aiWrap = document.getElementById('reg-ai-wrap');
  if (aiWrap) aiWrap.style.display = 'none';
```

- [ ] **Step 7: ブラウザで確認（ローカルHTTP経由・実GASに接続）**

1. 設定にURL・合言葉を入れておく。登録画面で名刺を撮る→`🤖 AIで読み取る`が出る。
2. 押す→ボタンが`⏳ 読み取り中…`＋ステータス表示→数秒後、各欄が反映され順にフラッシュ。名前/会社=「推測」、電話/メール=「要確認」。
3. 機内モード→AIボタン非表示（撮影時 `navigator.onLine=false`）。設定を空にして撮影→押下で設定誘導。
4. 上限到達・誤合言葉で、それぞれ優しいエラー＋手入力誘導。
5. OCRは `<details>` に畳まれ、開けば従来どおり動く。

- [ ] **Step 8: Commit**

```bash
git add customer-note.html
git commit -m "feat(step3): 🤖AIボタン＋runAiRead（ローディング/20秒タイムアウト/完了フラッシュ/各ガード/同意）＋OCRを格下げ"
```

---

### Task 6: fetchスタブ単体テスト ＋ 総合確認

**Files:**
- Create: `tests/ai-flow.test.js`

`runAiRead`/`applyParsed` はDOMに触れるため、ステップ2で確立した「実ファイルから関数を抽出し、`document`/`fetch` 等をスタブして `new Function` で実行する」手法で4ケースを検証する。

- [ ] **Step 1: スタブテストを書く**

Create `tests/ai-flow.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'customer-note.html'), 'utf8');

// applyParsed と aiErrorMessage を実ファイルから抽出して、DOMスタブ上で実行する
function extract(fnName) {
  const re = new RegExp('function ' + fnName + '\\s*\\([\\s\\S]*?\\n}\\n');
  const m = html.match(re);
  if (!m) throw new Error(fnName + ' not found');
  return m[0];
}

function makeEnv() {
  const fields = {};
  ['reg-name','reg-company','reg-phone','reg-email','reg-note','reg-paste-status']
    .forEach(id => { fields[id] = { value: '', textContent: '', style: {}, classList: { add(){}, remove(){} } }; });
  const document = {
    getElementById: id => fields[id] || { value: '', textContent: '', style: {}, classList: { add(){}, remove(){} } }
  };
  function setGuess() {}
  const env = { document, setGuess };
  const code = extract('applyParsed') + '\n' + extract('aiErrorMessage');
  new Function('document', 'setGuess', code + '\nthis.applyParsed = applyParsed; this.aiErrorMessage = aiErrorMessage;').call(env, document, setGuess);
  return { env, fields };
}

test('applyParsed(ai): 全項目を反映しmemoは追記', () => {
  const { env, fields } = makeEnv();
  fields['reg-note'].value = '守成クラブで交換';
  env.applyParsed({ name:'山田太郎', company:'山田工務店', phone:'086-426-1111', email:'a@b.jp', memo:'役職：代表' }, 'ai');
  assert.strictEqual(fields['reg-name'].value, '山田太郎');
  assert.strictEqual(fields['reg-phone'].value, '086-426-1111');
  assert.ok(fields['reg-note'].value.includes('守成クラブで交換'));
  assert.ok(fields['reg-note'].value.includes('役職：代表'));
  assert.ok(fields['reg-paste-status'].textContent.includes('AIが読み取りました'));
});

test('applyParsed: 空項目は既存の手入力を消さない', () => {
  const { env, fields } = makeEnv();
  fields['reg-name'].value = '既存名';
  env.applyParsed({ name:'', company:'X社', phone:'', email:'', memo:'' }, 'ai');
  assert.strictEqual(fields['reg-name'].value, '既存名');
  assert.strictEqual(fields['reg-company'].value, 'X社');
});

test('aiErrorMessage: 各コードに日本語', () => {
  const { env } = makeEnv();
  assert.ok(env.aiErrorMessage('limit').includes('上限'));
  assert.ok(env.aiErrorMessage('auth').includes('合言葉'));
  assert.ok(env.aiErrorMessage('bad_image').includes('大き'));
  assert.ok(env.aiErrorMessage(undefined).length > 0);
});
```

- [ ] **Step 2: テストを実行して通過を確認**

Run: `node --test tests/ai-flow.test.js`
Expected: PASS（3テスト）。失敗する場合は `applyParsed`/`aiErrorMessage` の抽出正規表現が実コードの整形に合うか確認（末尾 `\n}\n` 前提）。

- [ ] **Step 3: リグレッション**

Run: `node --test tests/parse-card.test.js` → 24/24
Run: `node --test tests/gas-helpers.test.js` → PASS
Run: `node --test tests/config-hash.test.js` → PASS

- [ ] **Step 4: 実機E2E（スマホ・実GAS接続）チェックリスト**

- [ ] QR/リンクで別端末に設定が入る（hashが消える）
- [ ] 撮影→🤖→反映→推測/要確認タグ→保存→ホーム表示→詳細表示
- [ ] 機内モードでボタン非表示・誤合言葉で優しいエラー・上限到達表示
- [ ] OCR（`<details>`）・手入力・検索・連絡した・削除・容量警告がデグレ無し
- [ ] リロード後もデータが残る／375px幅で崩れない

- [ ] **Step 5: Commit**

```bash
git add tests/ai-flow.test.js
git commit -m "test(step3): AI反映/エラー文言のスタブ単体テスト＋総合確認"
```

---

### Task 7: index.html 同期 ＋ セットアップ手順書

**Files:**
- Create: `docs/setup-guide-step3.md`
- Modify/Create: `index.html`（`customer-note.html` のコピー）

- [ ] **Step 1: セットアップ手順書を作成**

Create `docs/setup-guide-step3.md`（要点を記載。スキル⑨の `setup-guide.md` と同体裁）：

```markdown
# お客様ノート ステップ3 セットアップ手順（AI自動読取）

## 1. Anthropic APIキー
- https://console.anthropic.com でAPIキーを発行し、支払い（クレジット）を設定。

## 2. GAS Web App
1. https://script.google.com で新規プロジェクト → `gas/Code.gs` の内容を貼り付け。
2. プロジェクトの設定 → スクリプト プロパティに登録：
   - `ANTHROPIC_API_KEY` = 発行したAPIキー
   - `APP_SECRET` = 任意の合言葉（英数16文字程度）
3. `testProxy()` の SAMPLE を実際の名刺 dataURL に差し替えて実行 → ログに `{"ok":true,...}` を確認。
4. デプロイ → 新しいデプロイ → ウェブアプリ →「自分として実行」「アクセス: 全員」→ `/exec` URL を控える。
   ※再デプロイでURLが変わる/アクセス権が戻ることがある。変えたら設定を貼り直す。

## 3. アプリ側の設定
- アプリ ⚙️設定 に `/exec` URL と合言葉を入れ「保存して接続確認」→「✅ つながりました」。
- 人に渡すとき：「設定リンクをコピー」→ そのリンクをQR化して見せる（相手は読むだけ）。

## 注意
- 1日上限は `gas/Code.gs` の `CONFIG.maxPerDay`、モデルは `CONFIG.model`（`claude-haiku-4-5` → 精度が要るなら `claude-sonnet-4-6`）で変更。
- APIキーはGASのスクリプトプロパティのみに置く（アプリ・公開コードには出さない）。
```

- [ ] **Step 2: index.html を同期**

```bash
cp customer-note.html index.html
```
（Windows PowerShell の場合：`Copy-Item customer-note.html index.html -Force`）

- [ ] **Step 3: 差分が無いことを確認**

Run（Git Bash）：`diff -q customer-note.html index.html && echo SYNCED`
Expected: `SYNCED`

- [ ] **Step 4: Commit ＋ push**

```bash
git add index.html docs/setup-guide-step3.md
git commit -m "chore(step3): index.html同期＋セットアップ手順書"
git push
```

数分後 `https://cmkurashikibranch.github.io/customer-note/` に反映。

---

### Task 8（任意）: アプリ内QR表示（vendored・オフライン維持）

「設定リンクをコピー」で受け渡しは成立済み。さらに**アプリ内でQR画像を表示**したい場合のみ実施（極小QR生成ライブラリをインライン同梱）。

**Files:**
- Modify: `customer-note.html`

- [ ] **Step 1: 極小QRライブラリを取得してインライン同梱**

オフライン維持のため外部CDN読み込みはしない。実行時にMITの極小QR生成ライブラリ（例：`qrcode-generator`）の**ミニファイル内容を取得**し、`customer-note.html` の `<script>` 冒頭に `/* QRLIB:START */ … /* QRLIB:END */` で囲んで貼り付ける（ライブラリ本体はネットから取得した内容をそのまま inline）。

- [ ] **Step 2: 設定画面にQRキャンバスと表示ボタンを追加**

設定カードに `<div id="set-qr"></div>` と「QRを表示」ボタンを足し、`copySetupLink` と同じリンク文字列からQRを描画する関数を追加（ライブラリAPIに従う）。

- [ ] **Step 3: ブラウザで確認 → Commit ＋ index.html 同期 ＋ push**

```bash
cp customer-note.html index.html
git add customer-note.html index.html
git commit -m "feat(step3): 設定リンクのアプリ内QR表示（vendored・オフライン維持）"
git push
```

---

## 完了の定義

- `node --test tests/gas-helpers.test.js` / `tests/config-hash.test.js` / `tests/ai-flow.test.js` が全パス、`tests/parse-card.test.js` 24/24 維持。
- Task 0 で GitHub Pages → GAS の疎通（プリフライト無し・200本文）を実機確認済み。
- 撮影→🤖→反映→確認→保存が動作。ローディング・20秒タイムアウト・完了フラッシュ・各エラーの優しい誘導が機能。AI結果は name/company=「推測」、phone/email=「要確認」。
- URLは公開コードに出ず、QR/リンク（#cfg=）で設定が入る。合言葉照合・1日上限・画像バイト上限が効く。APIキーはGASのScript Propertiesのみ。
- ステップ1・2にデグレ無し。データ構造・保存ロジック不変。単一HTML・未使用時オフライン動作を維持。
```