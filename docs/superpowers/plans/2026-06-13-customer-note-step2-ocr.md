# お客様ノート ステップ2（OCR貼り付け＋自動振り分け）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スマホOCRでコピーした名刺テキストを貼り付け→[読み取る]で各項目に自動振り分けし、確認・修正して保存できるようにする（`customer-note.html` に追加）。

**Architecture:** 純関数 `parseCard(text) -> {name,company,phone,email,memo}` を HTML 内の `/* PARSER:START */ … /* PARSER:END */` ブロックに実装。ブロックは外部識別子を一切参照しない自己完結コードとし、末尾の `module.exports` ガードで Node から取り出してTDDする。UIは登録画面に貼り付けカードを足し、確認→反映→保存はステップ1の `saveCustomer` を流用。単一HTML・localStorage・オフライン・外部依存なしを維持。

**Tech Stack:** Vanilla HTML/CSS/JS、`node:test`（単体テスト）、ブラウザ（UI確認）

**作業ディレクトリ:** `C:\Users\kkmh2\claude\名刺顧客管理`

**設計書:** `docs/superpowers/specs/2026-06-13-customer-note-step2-ocr-design.md`

---

## File Structure

| ファイル | 責務 |
|---------|------|
| `customer-note.html` | アプリ本体。`parseCard`（PARSERブロック）＋登録画面UI＋詳細画面の改行修正 |
| `tests/parse-card.test.js` | `parseCard` の単体テスト（HTMLからブロックを抽出して検証） |

実行順（タスク）：parseCard をTDDで段階実装（Task 1〜3）→ 登録画面UI（Task 4）→ 詳細修正＋総合確認（Task 5）。

テスト実行コマンド（共通）：`node --test tests/parse-card.test.js`（ディレクトリ指定はMODULE_NOT_FOUNDになる環境のため**ファイル直接指定**）。

---

### Task 1: テスト土台 ＋ parseCard 骨格（正規化・行分割・email・メモ組み立て）

**Files:**
- Create: `tests/parse-card.test.js`
- Modify: `customer-note.html`（`<script>` 内、`function showView(name) {` の直前に PARSER ブロックを挿入）

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/parse-card.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function loadParseCard() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'customer-note.html'), 'utf8');
  const m = html.match(/\/\* PARSER:START \*\/([\s\S]*?)\/\* PARSER:END \*\//);
  if (!m) throw new Error('PARSER block not found in customer-note.html');
  const mod = { exports: {} };
  new Function('module', 'exports', m[1])(mod, mod.exports);
  if (typeof mod.exports.parseCard !== 'function') throw new Error('parseCard not exported');
  return mod.exports.parseCard;
}
const parseCard = loadParseCard();

test('空文字・空白のみは全項目空・例外なし', () => {
  assert.deepStrictEqual(parseCard(''), { name:'', company:'', phone:'', email:'', memo:'' });
  assert.deepStrictEqual(parseCard('   \n  \n'), { name:'', company:'', phone:'', email:'', memo:'' });
});

test('email を抽出する', () => {
  assert.strictEqual(parseCard('info@example.co.jp').email, 'info@example.co.jp');
});

test('全角のメール（＠／．／全角英字）を正規化して抽出', () => {
  assert.strictEqual(parseCard('ｉｎｆｏ＠ｅｘａｍｐｌｅ．ｃｏ．ｊｐ').email, 'info@example.co.jp');
});

test('メール末尾の全角括弧・句点を除去', () => {
  assert.strictEqual(parseCard('（info@example.com）').email, 'info@example.com');
});

test('長文（5000字超）でも例外を投げずオブジェクトを返す', () => {
  const r = parseCard('x'.repeat(6000));
  assert.strictEqual(typeof r, 'object');
});

test('冪等：同じ入力なら同じ出力', () => {
  const input = 'info@example.co.jp\nなにかの行';
  assert.deepStrictEqual(parseCard(input), parseCard(input));
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/parse-card.test.js`
Expected: FAIL（`PARSER block not found in customer-note.html`）

- [ ] **Step 3: PARSER 骨格を実装**

`customer-note.html` の `function showView(name) {` の**直前**に、次のブロックを挿入する（Edit: 検索文字列 `function showView(name) {` を、下記＋空行＋`function showView(name) {` に置換）。各ステージは順序が仕様。空のステージはTask 2・3で埋める。

```js
/* PARSER:START */
function parseCard(text) {
  text = String(text == null ? '' : text);
  if (text.length > 5000) text = text.slice(0, 5000);

  // --- 正規化（全角→半角） ---
  const norm = text
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/＠/g, '@')
    .replace(/．/g, '.')
    .replace(/[ー－‐―−]/g, '-')
    .replace(/℡/g, 'TEL')
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/　/g, ' ');

  const lines = norm.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const used = lines.map(() => false);
  const extraMemo = [];
  const result = { name: '', company: '', phone: '', email: '', memo: '' };
  let titleStr = '';
  let splitName = '';

  // --- STAGE: email ---
  const emailRe = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(emailRe);
    if (m) { result.email = m[0].replace(/[^A-Za-z]+$/, ''); used[i] = true; break; }
  }

  // --- STAGE: title (Task 3) ---
  // --- STAGE: company (Task 3) ---
  // --- STAGE: exclude-address (Task 2) ---
  // --- STAGE: phone-fax (Task 2) ---
  // --- STAGE: name (Task 3) ---

  // --- assemble memo ---
  const memoParts = [];
  if (titleStr) memoParts.push('役職：' + titleStr);
  for (const m of extraMemo) memoParts.push(m);
  for (let i = 0; i < lines.length; i++) if (!used[i]) memoParts.push(lines[i]);
  result.memo = memoParts.join('\n');

  return result;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { parseCard };
/* PARSER:END */
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `node --test tests/parse-card.test.js`
Expected: PASS（6テスト）。※この時点では name/company/phone は未実装。email 以外の行は memo に入る。

- [ ] **Step 5: Commit**

```bash
git add tests/parse-card.test.js customer-note.html
git commit -m "feat(step2): parseCard骨格＋テスト土台（正規化・email・メモ組み立て）"
```

---

### Task 2: 電話/FAX判別 ＋ 住所・〒・URL 除外行

**Files:**
- Modify: `customer-note.html`（PARSER ブロックの `// --- STAGE: exclude-address (Task 2) ---` と `// --- STAGE: phone-fax (Task 2) ---`）
- Modify: `tests/parse-card.test.js`（テスト追記）

- [ ] **Step 1: 失敗するテストを追記**

`tests/parse-card.test.js` の末尾に追記：

```js
test('携帯番号を phone に', () => {
  assert.strictEqual(parseCard('090-1234-5678').phone, '090-1234-5678');
});

test('固定電話（ハイフン付き）は元の区切りを保つ', () => {
  assert.strictEqual(parseCard('TEL 086-426-1111').phone, '086-426-1111');
});

test('全角数字の電話を正規化して抽出', () => {
  assert.strictEqual(parseCard('ＴＥＬ　０９０－１２３４－５６７８').phone, '090-1234-5678');
});

test('℡ 記号を TEL とみなす', () => {
  assert.strictEqual(parseCard('℡ 086-426-1111').phone, '086-426-1111');
});

test('+81 形式を 0 始まりに正規化', () => {
  assert.strictEqual(parseCard('+81-90-1234-5678').phone, '090-1234-5678');
});

test('同一行の TEL/FAX は TEL を採用し FAX はメモへ', () => {
  const r = parseCard('TEL 086-426-1111 FAX 086-426-2222');
  assert.strictEqual(r.phone, '086-426-1111');
  assert.ok(r.memo.includes('086-426-2222'), 'memo に FAX 番号が残る');
});

test('FAX のみの行は phone を空にしメモへ', () => {
  const r = parseCard('FAX 086-426-2222');
  assert.strictEqual(r.phone, '');
  assert.ok(r.memo.includes('086-426-2222'));
});

test('〒＋番地の住所行は電話に化けず memo へ', () => {
  const r = parseCard('〒700-0000 岡山県倉敷市青葉町1-2-3');
  assert.strictEqual(r.phone, '');
  assert.ok(r.memo.includes('倉敷市'));
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/parse-card.test.js`
Expected: FAIL（phone 系・住所除外の新規テストが失敗）

- [ ] **Step 3: 除外行ステージを実装**

Edit: `customer-note.html` の行 `  // --- STAGE: exclude-address (Task 2) ---` を次に置換：

```js
  // --- STAGE: exclude-address ---
  const addrRe = /〒|郵便番号|丁目|番地|[都道府県].{0,8}[市区町村]|[市区町村].{0,10}\d|https?:\/\/|www\./;
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    if (addrRe.test(lines[i])) { extraMemo.push(lines[i]); used[i] = true; }
  }
```

- [ ] **Step 4: 電話/FAX ステージを実装**

Edit: `customer-note.html` の行 `  // --- STAGE: phone-fax (Task 2) ---` を次に置換：

```js
  // --- STAGE: phone-fax ---
  function formatPhone(tok) {
    if (!/\+81/.test(tok) && /-/.test(tok)) {
      return tok.replace(/[()\s]+/g, '').replace(/[^\d-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    }
    const d = tok.replace(/[^\d]/g, '').replace(/^81/, '0');
    if (/^(070|080|090)\d{8}$/.test(d)) return d.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
    if (/^(0120|0800)\d{6}$/.test(d)) return d.replace(/(\d{4})(\d{3})(\d{3})/, '$1-$2-$3');
    return d;
  }
  const phoneTok = /(?:\+81|0)[\d\-()\s]{7,13}\d/g;
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    const line = lines[i];
    const toks = line.match(phoneTok);
    if (!toks) continue;
    let lineHadTel = false;
    const memoNums = [];
    for (const tok of toks) {
      const digits = tok.replace(/[^\d]/g, '').replace(/^81/, '0');
      if (!/^0\d{9,10}$/.test(digits)) continue;
      const before = line.slice(0, line.indexOf(tok));
      const isFax = /FAX|ファ?ックス/i.test(before) && !/TEL|電話|携帯/i.test(before.slice(-6));
      const formatted = formatPhone(tok);
      if (!isFax && !result.phone) { result.phone = formatted; lineHadTel = true; }
      else { memoNums.push(isFax ? 'FAX ' + formatted : formatted); }
    }
    if (lineHadTel || memoNums.length) {
      used[i] = true;
      memoNums.forEach(n => extraMemo.push(n));
    }
  }
```

- [ ] **Step 5: テストを実行して通過を確認**

Run: `node --test tests/parse-card.test.js`
Expected: PASS（Task 1 の6 ＋ Task 2 の8 ＝ 14テスト）

- [ ] **Step 6: Commit**

```bash
git add tests/parse-card.test.js customer-note.html
git commit -m "feat(step2): 電話/FAX判別＋住所・〒・URL除外"
```

---

### Task 3: 会社 ＋ 役職（同一行の名前分割）＋ 名前推測 ＋ 統合

**Files:**
- Modify: `customer-note.html`（PARSER ブロックの `title` / `company` / `name` ステージ）
- Modify: `tests/parse-card.test.js`（テスト追記）

- [ ] **Step 1: 失敗するテストを追記**

`tests/parse-card.test.js` の末尾に追記：

```js
test('株式会社を含む行を company に', () => {
  assert.strictEqual(parseCard('株式会社山田工務店').company, '株式会社山田工務店');
});

test('屋号（〇〇屋・行末・3字以上）を company に', () => {
  assert.strictEqual(parseCard('山田屋').company, '山田屋');
});

test('役職＋名前が同一行：名前を分割し役職はメモへ', () => {
  const r = parseCard('代表取締役 山田太郎');
  assert.strictEqual(r.name, '山田太郎');
  assert.ok(r.memo.startsWith('役職：代表取締役'));
});

test('「営業部 部長」は部署を名前にせず役職のみ', () => {
  const r = parseCard('営業部 部長');
  assert.strictEqual(r.name, '');
  assert.ok(r.memo.includes('役職：部長'));
});

test('店長(役職)は会社に誤判定しない', () => {
  const r = parseCard('店長');
  assert.strictEqual(r.company, '');
  assert.ok(r.memo.includes('役職：店長'));
});

test('漢字フルネーム（姓 名）を name に', () => {
  assert.strictEqual(parseCard('山田 太郎').name, '山田 太郎');
});

test('ふりがな行より漢字名を優先', () => {
  const r = parseCard('やまだ たろう\n山田 太郎');
  assert.strictEqual(r.name, '山田 太郎');
});

test('標準的な名刺：全項目を埋める', () => {
  const card = [
    '株式会社 山田工務店',
    '代表取締役 山田太郎',
    '〒700-0000 岡山県倉敷市青葉町1-2-3',
    'TEL 086-426-1111  FAX 086-426-2222',
    'yamada@example.co.jp'
  ].join('\n');
  const r = parseCard(card);
  assert.strictEqual(r.company, '株式会社 山田工務店');
  assert.strictEqual(r.name, '山田太郎');
  assert.strictEqual(r.phone, '086-426-1111');
  assert.strictEqual(r.email, 'yamada@example.co.jp');
  assert.ok(r.memo.includes('役職：代表取締役'));
  assert.ok(r.memo.includes('倉敷市'));
  assert.ok(r.memo.includes('086-426-2222'));
});

test('一致ゼロ（記号の羅列）は全項目空・例外なし', () => {
  const r = parseCard('### ^^^ ~~~');
  assert.strictEqual(r.name, '');
  assert.strictEqual(r.company, '');
  assert.strictEqual(r.phone, '');
  assert.strictEqual(r.email, '');
});

test('英語のみ名刺：email/company は拾い、落ちない', () => {
  const r = parseCard('Yamada Design Inc.\ninfo@yamada.com');
  assert.strictEqual(r.email, 'info@yamada.com');
  assert.ok(r.company.includes('Inc.'));
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/parse-card.test.js`
Expected: FAIL（会社・役職・名前の新規テストが失敗）

- [ ] **Step 3: 役職ステージを実装（キーワード定義もここで宣言）**

Edit: `customer-note.html` の行 `  // --- STAGE: title (Task 3) ---` を次に置換：

```js
  // --- keyword 定義（title/company/name で共用） ---
  const TITLE_KW = ['代表取締役','代表社員','代表理事','取締役','代表','会長','社長','副社長','専務','常務','部長','次長','課長','係長','主任','主査','室長','店長','施設長','管理者','園長','院長','理事長','理事','主宰','オーナー','マネージャー','ディレクター','プロデューサー','CEO','COO','CFO','CTO'];
  const COMPANY_RE = /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|NPO法人|協同組合|信用金庫|信用組合|\(株\)|\(有\)|法人|組合|協会|銀行|工務店|建設|事務所|商店|商会|製作所|工房|クリニック|医院|歯科|薬局|病院|デザイン|コンサル|ファーム|カンパニー|Co\.|Inc\.|Ltd\.|LLC|K\.K\.)/;
  const COMPANY_SUFFIX = ['店','屋','堂','庵'];
  const DEPT_RE = /部|課|室|係|グループ|事業|営業|総務|人事|経理|開発|本部|支店|営業所/;

  // --- STAGE: title ---
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    const kw = TITLE_KW.find(k => lines[i].includes(k));
    if (!kw) continue;
    titleStr = kw;
    let rest = lines[i];
    TITLE_KW.forEach(k => { rest = rest.split(k).join(' '); });
    rest = rest.trim();
    if (rest && !DEPT_RE.test(rest)) {
      const nm = rest.match(/[一-龥]{2,4}(?:\s[一-龥]{1,3})?|[A-Za-z]+\s[A-Za-z]+/);
      if (nm) splitName = nm[0].replace(/\s+/g, ' ').trim();
    }
    used[i] = true;
    break;
  }
```

- [ ] **Step 4: 会社ステージを実装**

Edit: `customer-note.html` の行 `  // --- STAGE: company (Task 3) ---` を次に置換：

```js
  // --- STAGE: company ---
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    if (COMPANY_RE.test(lines[i])) { result.company = lines[i].trim(); used[i] = true; break; }
  }
  if (!result.company) {
    for (let i = 0; i < lines.length; i++) {
      if (used[i]) continue;
      if (COMPANY_SUFFIX.includes(lines[i].slice(-1)) && lines[i].length >= 3) {
        result.company = lines[i].trim(); used[i] = true; break;
      }
    }
  }
```

- [ ] **Step 5: 名前ステージを実装**

Edit: `customer-note.html` の行 `  // --- STAGE: name (Task 3) ---` を次に置換：

```js
  // --- STAGE: name ---
  if (splitName) {
    result.name = splitName;
  } else {
    let bestScore = -Infinity, bestIdx = -1, bestVal = '';
    for (let i = 0; i < lines.length; i++) {
      if (used[i]) continue;
      const l = lines[i];
      if (/\d/.test(l)) continue;
      if (COMPANY_RE.test(l)) continue;
      if (TITLE_KW.some(k => l.includes(k))) continue;
      const noSpace = l.replace(/\s/g, '');
      let score = 0;
      if (/[一-龥]/.test(l)) score += 2;
      if (/^[ぁ-ん\s]+$/.test(l)) score -= 1;
      if (/^[A-Za-z]+\s[A-Za-z]+$/.test(l)) score += 1;
      if (noSpace.length >= 2 && noSpace.length <= 6) score += 1;
      if (/^[一-龥]{1,4}\s[一-龥]{1,4}$/.test(l)) score += 1;
      if (score > bestScore) { bestScore = score; bestIdx = i; bestVal = l.replace(/\s+/g, ' ').trim(); }
    }
    if (bestScore >= 1) { result.name = bestVal; used[bestIdx] = true; }
  }
```

- [ ] **Step 6: テストを実行して通過を確認**

Run: `node --test tests/parse-card.test.js`
Expected: PASS（合計24テスト）

- [ ] **Step 7: Commit**

```bash
git add tests/parse-card.test.js customer-note.html
git commit -m "feat(step2): 会社・役職(名前分割)・名前推測の振り分け完成"
```

---

### Task 4: 登録画面の貼り付けUI（読み取る・クリア・推測マーカー・状態）

**Files:**
- Modify: `customer-note.html`（`<style>` / `#view-register` の HTML / `<script>` のハンドラ）

- [ ] **Step 1: CSS を追加**

Edit: `customer-note.html` の行 `  .cust-sub { font-size:12px; color:var(--text-2); }` を次に置換（直後にスタイルを追加）：

```css
  .cust-sub { font-size:12px; color:var(--text-2); }
  .paste-actions { display:flex; gap:8px; align-items:center; margin-top:8px; }
  .btn-sm { padding:8px 14px; font-size:13px; }
  #reg-paste-status { display:none; margin-top:8px; font-size:13px; color:var(--accent); white-space:pre-line; line-height:1.5; }
  .paste-help { margin-top:8px; font-size:12px; color:var(--text-2); }
  .paste-help summary { cursor:pointer; }
  .field-input.guessed { border-color:var(--accent); border-style:dashed; }
  .guess-tag { font-size:11px; color:var(--accent); margin-left:6px; display:none; }
  .guess-tag.on { display:inline; }
```

- [ ] **Step 2: 貼り付けカードの HTML を挿入**

Edit: 次の2行（写真カード内の差し込みコメントと、その直後の写真カード閉じタグ。コメントが一意なので2行で一意のanchorになる）を：

```html
    <!-- 将来のOCR/AIボタン差し込み位置 -->
  </div>
```

次に置換する（写真カードを閉じ、独立した貼り付けカードを開いて閉じる）：

```html
  </div>
  <div class="card">
    <label class="field-label">名刺の文字を貼り付け（スマホのOCRでコピー）</label>
    <textarea id="reg-paste" class="field-input" rows="4"
      placeholder="スマホで名刺の文字をコピーして、ここに長押し→ペースト"
      autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
    <div class="paste-actions">
      <button class="btn btn-sm" onclick="runParse()">✨ 読み取る</button>
      <button class="btn btn-ghost btn-sm" onclick="clearPaste()">クリア</button>
    </div>
    <div id="reg-paste-status" aria-live="polite"></div>
    <details class="paste-help">
      <summary>コピーのやり方（iPhone / Android）</summary>
      iPhone：写真アプリで名刺を開き、文字を長押し→「すべて選択」→コピー。<br>
      Android：Googleレンズで名刺を写し、テキストを選択→コピー。<br>
      その後この欄を長押し→ペーストして［読み取る］。
    </details>
  </div>
```

これで `.card`（写真）→ `.card`（貼り付け）→ `.card`（名前等）が各々正しく開閉する（`<div>`/`</div>` の数は不変）。

- [ ] **Step 3: HTML構造をブラウザ／目視で確認**

`customer-note.html` の `#view-register` を見て、`写真カード(.card)` → `貼り付けカード(.card)` → `名前等カード(.card)` → `保存ボタン` の順に、各 `.card` が正しく開閉していることを確認（`</div>` の数が合っているか）。崩れていれば修正。

- [ ] **Step 4: 名前・会社入力欄に推測タグを追加**

Edit: 行 `    <input type="text" id="reg-name" class="field-input" placeholder="山田 太郎">` を次に置換：

```html
    <input type="text" id="reg-name" class="field-input" placeholder="山田 太郎"><span id="reg-name-guess" class="guess-tag">推測</span>
```

Edit: 行 `    <input type="text" id="reg-company" class="field-input">` を次に置換：

```html
    <input type="text" id="reg-company" class="field-input"><span id="reg-company-guess" class="guess-tag">推測</span>
```

- [ ] **Step 5: メモ欄のラベルと行数を更新**

Edit: 行 `    <label class="field-label">メモ（出会った場所など）</label>` を次に置換：

```html
    <label class="field-label">メモ（役職・住所・出会った場所など）</label>
```

Edit: 行 `    <textarea id="reg-note" class="field-input" rows="2"></textarea>` を次に置換：

```html
    <textarea id="reg-note" class="field-input" rows="4"></textarea>
```

- [ ] **Step 6: 貼り付けハンドラを追加**

Edit: `customer-note.html` の行 `function showView(name) {` を次に置換（その前にハンドラ群を追加）：

```js
function setGuess(fieldId, on) {
  const input = document.getElementById(fieldId);
  const tag = document.getElementById(fieldId + '-guess');
  if (on) { input.classList.add('guessed'); if (tag) tag.classList.add('on'); }
  else { input.classList.remove('guessed'); if (tag) tag.classList.remove('on'); }
}

function runParse() {
  const ta = document.getElementById('reg-paste');
  if (!ta.value.trim()) { alert('貼り付け欄が空です'); return; }
  const ids = ['reg-name','reg-company','reg-phone','reg-email','reg-note'];
  const hasContent = ids.some(id => document.getElementById(id).value.trim());
  if (hasContent && !confirm('入力済みの内容を読み取り結果で置き換えますか？')) return;
  const p = parseCard(ta.value);
  if (p.name)    { document.getElementById('reg-name').value = p.name; setGuess('reg-name', true); }
  if (p.company) { document.getElementById('reg-company').value = p.company; setGuess('reg-company', true); }
  if (p.phone)   { document.getElementById('reg-phone').value = p.phone; }
  if (p.email)   { document.getElementById('reg-email').value = p.email; }
  if (p.memo) {
    const note = document.getElementById('reg-note');
    const existing = note.value.split('\n').map(s => s.trim()).filter(Boolean);
    p.memo.split('\n').map(s => s.trim()).filter(Boolean)
      .forEach(line => { if (!existing.includes(line)) existing.push(line); });
    note.value = existing.join('\n');
  }
  let msg = '✨ 読み取りました。電話とメールはそのまま、お名前と会社は念のため確認してくださいね';
  if (!p.phone && !p.email) msg += '\n（電話・メールは見つかりませんでした。手で入れてくださいね）';
  if (!p.name) msg += '\n（お名前は読み取れませんでした。上の欄にご記入を）';
  const st = document.getElementById('reg-paste-status');
  st.textContent = msg; st.style.display = 'block';
}

function clearPaste() {
  document.getElementById('reg-paste').value = '';
  ['reg-name','reg-company','reg-phone','reg-email','reg-note'].forEach(id => {
    document.getElementById(id).value = '';
  });
  setGuess('reg-name', false); setGuess('reg-company', false);
  const st = document.getElementById('reg-paste-status');
  st.style.display = 'none'; st.textContent = '';
}

function showView(name) {
```

- [ ] **Step 7: 編集で推測マーカーを外す・resetRegisterForm を拡張**

Edit: `customer-note.html` の行 `function resetRegisterForm() {` の本体に貼り付け関連のリセットを足す。行 `  document.getElementById('reg-photo-input').value = '';` を次に置換：

```js
  document.getElementById('reg-photo-input').value = '';
  document.getElementById('reg-paste').value = '';
  setGuess('reg-name', false); setGuess('reg-company', false);
  const _st = document.getElementById('reg-paste-status');
  _st.style.display = 'none'; _st.textContent = '';
```

Edit: スクリプト末尾の行 `document.getElementById('reg-photo-input').addEventListener('change', (e) => {` の**直前**に、入力で推測タグを外すリスナーを追加（検索文字列をそのリスナー宣言にして前置）：

```js
['reg-name','reg-company'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => setGuess(id, false));
});

document.getElementById('reg-photo-input').addEventListener('change', (e) => {
```

- [ ] **Step 8: ブラウザで確認**

ローカルHTTPサーバーで `customer-note.html` を開く（`file:` はMCPでブロックされるため）。登録画面で：
1. 貼り付け欄に下記を貼り、［読み取る］→ 名前=山田太郎（推測タグ表示）・会社=株式会社 山田工務店（推測タグ）・電話=086-426-1111・メール=yamada@example.co.jp・メモに「役職：代表取締役 / 倉敷市… / FAX 086-426-2222」が入る。状態メッセージが常駐表示される。
```
株式会社 山田工務店
代表取締役 山田太郎
〒700-0000 岡山県倉敷市青葉町1-2-3
TEL 086-426-1111  FAX 086-426-2222
yamada@example.co.jp
```
2. 名前欄を手で編集 → 推測タグが消える。
3. もう一度［読み取る］→「置き換えますか？」確認が出る。
4. 空のまま［読み取る］→「貼り付け欄が空です」。
5. ［クリア］→ 貼り付け欄＋5項目＋状態が消え、写真プレビューは残る。

- [ ] **Step 9: Commit**

```bash
git add customer-note.html
git commit -m "feat(step2): 登録画面の貼り付けUI（読み取る・クリア・推測マーカー・状態）"
```

---

### Task 5: 詳細画面の改行対応 ＋ 総合動作確認

**Files:**
- Modify: `customer-note.html`（詳細画面の履歴note描画）

- [ ] **Step 1: 履歴noteの改行を保持**

Edit: `customer-note.html` の行 `      <div style="font-size:14px;">${escapeHtml(h.note)}</div>` を次に置換：

```js
      <div style="font-size:14px; white-space:pre-wrap;">${escapeHtml(h.note)}</div>
```

- [ ] **Step 2: 総合動作確認（ローカルHTTP経由・ブラウザ）**

localStorageをクリアした新規状態から：
1. Task 4 のサンプルを貼り付け → 読み取り → ［保存する］→ ホームに「山田太郎さん」が表示。
2. 詳細を開く → 名前「山田太郎さん」・会社「株式会社 山田工務店」・電話/メールのワンタップボタン。
3. やりとり履歴の1件目に、メモが**改行を保ったまま**（役職：代表取締役／倉敷市…／FAX…）表示される（1行に潰れない）。
4. 写真なしでOCR貼り付けのみの登録 → 👤アイコンで一覧表示。
5. 既存（ステップ1）の手入力フロー・検索・連絡した・削除・容量警告がデグレしていないこと。
6. リロード後もデータが残ること。スマホ幅（375px）でレイアウトが崩れないこと。

- [ ] **Step 3: 単体テストの最終確認**

Run: `node --test tests/parse-card.test.js`
Expected: PASS（24テスト）。

- [ ] **Step 4: Commit**

```bash
git add customer-note.html
git commit -m "feat(step2): 履歴noteの改行対応＋総合動作確認完了"
```

---

## 完了の定義

- `node --test tests/parse-card.test.js` が全パス（24ケース：正常系・誤検出回避・エッジ・冪等）
- 登録画面で「貼り付け→読み取る→確認→反映→保存」が動作。推測マーカー・状態メッセージ・クリア・空入力ガード・再解析の確認ダイアログが機能
- 詳細画面の履歴で複数行メモが改行保持で表示される
- ステップ1の既存機能にデグレなし／データ構造・保存ロジックは不変
- 単一HTML・外部依存なし・オフライン動作を維持
