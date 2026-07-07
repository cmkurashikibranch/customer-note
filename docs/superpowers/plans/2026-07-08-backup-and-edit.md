# バックアップ＋編集機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** お客様ノートに①バックアップ（書き出し・読み込み・リマインド）②お客様情報の編集機能を追加する。

**Architecture:** 単一HTML（`customer-note.html`）に集約。純関数は `/* BACKUP:START */…/* BACKUP:END */` ブロック＋`module.exports` ガードで自己完結させ、Nodeで単体テスト（既存の PARSER/CFGHASH パターン踏襲）。UI層は既存の view 切替・`appData`/`saveData()` に乗せる。

**Tech Stack:** Vanilla JS（ブラウザ）、node:test（テスト）、localStorage。

**Spec:** `docs/superpowers/specs/2026-07-08-backup-and-edit-design.md`（v2）

## Global Constraints

- 対象ファイルは `C:\Users\kkmh2\claude\名刺顧客管理\customer-note.html` のみ（`index.html` への同期は最終タスクで1回だけ）
- テスト実行は `node --test tests/ファイル名.test.js`（ディレクトリ指定はこの環境でMODULE_NOT_FOUNDになる）
- UI文言はやさしい日本語（設計書の文言を一字一句コピー）
- バックアップに AI設定（aiEndpoint/aiSecret/aiConsent）と lastBackup は**含めない**
- 既存46テスト（parse-card 25 / gas-helpers 13 / config-hash 5 / ai-flow 3）を壊さない
- push は最終タスクのみ。pre-pushフックが秘密スキャン・index.html同期を検査する

---

### Task 1: バックアップ純関数（BACKUP ブロック）＋単体テスト

**Files:**
- Modify: `customer-note.html`（`/* CFGHASH:END */` の直後、391行目付近に BACKUP ブロックを追加。`DEFAULT_DATA.settings` にフィールド2つ追加）
- Test: `tests/backup.test.js`（新規）

**Interfaces:**
- Produces:
  - `buildBackupEnvelope(appData, today)` → `{ app, version, exportedAt, data: { customers, nextId, settings: { followUpDays } } }`
  - `backupFilename(today)` → `'お客様ノート_バックアップ_' + today + '.json'`
  - `validateBackup(text)` → 封筒オブジェクト／`{ tooNew: true }`／`null`
  - `normalizeBackup(envelope, currentSettings, defaultSettings, today)` → `{ customers, settings, nextId }`（appDataそのままの形）
  - `DEFAULT_DATA.settings` に `lastBackup: ''`・`reminderSnoozedOn: ''` が増える

- [ ] **Step 1: 失敗するテストを書く**

`tests/backup.test.js` を新規作成：

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function loadBackup() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'customer-note.html'), 'utf8');
  const m = html.match(/\/\* BACKUP:START \*\/([\s\S]*?)\/\* BACKUP:END \*\//);
  if (!m) throw new Error('BACKUP block not found in customer-note.html');
  const mod = { exports: {} };
  new Function('module', 'exports', m[1])(mod, mod.exports);
  return mod.exports;
}
const { buildBackupEnvelope, backupFilename, validateBackup, normalizeBackup } = loadBackup();

const DEFAULTS = { followUpDays: 14, aiEndpoint: '', aiSecret: '', aiConsent: false, lastBackup: '', reminderSnoozedOn: '' };
const CURRENT  = { followUpDays: 14, aiEndpoint: 'https://gas/exec', aiSecret: 'himitsu', aiConsent: true, lastBackup: '2026-07-01', reminderSnoozedOn: '2026-07-05' };

function sampleAppData() {
  return {
    customers: [{ id: 3, name: '山田 太郎', company: '山田工務店', phone: '', email: '', photo: null, lastContact: '2026-07-01', history: [{ date: '2026-07-01', note: '登録' }] }],
    settings: Object.assign({}, CURRENT),
    nextId: 4
  };
}

// --- buildBackupEnvelope ---
test('封筒形式：app/version/exportedAt/data が揃う', () => {
  const env = buildBackupEnvelope(sampleAppData(), '2026-07-08');
  assert.strictEqual(env.app, 'customer-note');
  assert.strictEqual(env.version, 1);
  assert.strictEqual(env.exportedAt, '2026-07-08');
  assert.strictEqual(env.data.customers.length, 1);
  assert.strictEqual(env.data.nextId, 4);
  assert.strictEqual(env.data.settings.followUpDays, 14);
});
test('封筒にAI設定とlastBackupが含まれない', () => {
  const env = buildBackupEnvelope(sampleAppData(), '2026-07-08');
  const json = JSON.stringify(env);
  assert.ok(!json.includes('himitsu'));
  assert.ok(!json.includes('aiEndpoint'));
  assert.ok(!json.includes('aiSecret'));
  assert.ok(!json.includes('aiConsent'));
  assert.ok(!json.includes('lastBackup'));
});

// --- backupFilename ---
test('ファイル名に日付が入る', () => {
  assert.strictEqual(backupFilename('2026-07-08'), 'お客様ノート_バックアップ_2026-07-08.json');
});

// --- validateBackup ---
test('正常な封筒はそのまま返る（往復）', () => {
  const env = buildBackupEnvelope(sampleAppData(), '2026-07-08');
  const v = validateBackup(JSON.stringify(env));
  assert.deepStrictEqual(v, env);
});
test('壊れたJSONは null（例外を投げない）', () => {
  assert.strictEqual(validateBackup('{oops'), null);
  assert.strictEqual(validateBackup(''), null);
  assert.strictEqual(validateBackup(null), null);
});
test('appが違うファイルは null', () => {
  assert.strictEqual(validateBackup(JSON.stringify({ app: 'other', version: 1, data: { customers: [] } })), null);
});
test('customersが配列でなければ null', () => {
  assert.strictEqual(validateBackup(JSON.stringify({ app: 'customer-note', version: 1, data: { customers: 'x' } })), null);
});
test('id/nameが欠けたcustomerがいたら null', () => {
  assert.strictEqual(validateBackup(JSON.stringify({ app: 'customer-note', version: 1, data: { customers: [{ id: 1 }] } })), null);
  assert.strictEqual(validateBackup(JSON.stringify({ app: 'customer-note', version: 1, data: { customers: [{ name: 'x' }] } })), null);
});
test('version>1 は tooNew', () => {
  const v = validateBackup(JSON.stringify({ app: 'customer-note', version: 2, data: { customers: [] } }));
  assert.deepStrictEqual(v, { tooNew: true });
});

// --- normalizeBackup ---
test('lastContact欠落はexportedAtで補完・history非配列は[]', () => {
  const env = { app: 'customer-note', version: 1, exportedAt: '2026-06-20', data: { customers: [{ id: 1, name: 'A' }], nextId: 2, settings: { followUpDays: 7 } } };
  const out = normalizeBackup(env, CURRENT, DEFAULTS, '2026-07-08');
  assert.strictEqual(out.customers[0].lastContact, '2026-06-20');
  assert.deepStrictEqual(out.customers[0].history, []);
});
test('exportedAtも無ければ今日で補完', () => {
  const env = { app: 'customer-note', version: 1, data: { customers: [{ id: 1, name: 'A' }], nextId: 2 } };
  const out = normalizeBackup(env, CURRENT, DEFAULTS, '2026-07-08');
  assert.strictEqual(out.customers[0].lastContact, '2026-07-08');
});
test('AI設定・lastBackup・スヌーズは現端末値を維持し、followUpDaysはファイル値', () => {
  const env = { app: 'customer-note', version: 1, exportedAt: '2026-06-20', data: { customers: [], nextId: 1, settings: { followUpDays: 30 } } };
  const out = normalizeBackup(env, CURRENT, DEFAULTS, '2026-07-08');
  assert.strictEqual(out.settings.aiEndpoint, 'https://gas/exec');
  assert.strictEqual(out.settings.aiSecret, 'himitsu');
  assert.strictEqual(out.settings.aiConsent, true);
  assert.strictEqual(out.settings.lastBackup, '2026-07-01');
  assert.strictEqual(out.settings.reminderSnoozedOn, '2026-07-05');
  assert.strictEqual(out.settings.followUpDays, 30);
});
test('followUpDaysが不正なら現端末値のまま', () => {
  const env = { app: 'customer-note', version: 1, data: { customers: [], nextId: 1, settings: { followUpDays: 'x' } } };
  const out = normalizeBackup(env, CURRENT, DEFAULTS, '2026-07-08');
  assert.strictEqual(out.settings.followUpDays, 14);
});
test('nextIdはmax(id)+1未満なら補正・空配列でも安全', () => {
  const env1 = { app: 'customer-note', version: 1, exportedAt: '2026-06-20', data: { customers: [{ id: 9, name: 'A', lastContact: '2026-06-01', history: [] }], nextId: 2 } };
  assert.strictEqual(normalizeBackup(env1, CURRENT, DEFAULTS, '2026-07-08').nextId, 10);
  const env2 = { app: 'customer-note', version: 1, data: { customers: [] } };
  assert.strictEqual(normalizeBackup(env2, CURRENT, DEFAULTS, '2026-07-08').nextId, 1);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/backup.test.js`
Expected: FAIL（`BACKUP block not found in customer-note.html`）

- [ ] **Step 3: 実装（BACKUPブロック＋DEFAULT_DATA拡張）**

`customer-note.html` の `/* CFGHASH:END */` の直後（現在の391行目の後）に追加：

```js
/* BACKUP:START */
function buildBackupEnvelope(appData, today) {
  return {
    app: 'customer-note',
    version: 1,
    exportedAt: today,
    data: {
      customers: appData.customers,
      nextId: appData.nextId,
      settings: { followUpDays: appData.settings.followUpDays }
    }
  };
}
function backupFilename(today) {
  return 'お客様ノート_バックアップ_' + today + '.json';
}
function validateBackup(text) {
  var o;
  try { o = JSON.parse(String(text == null ? '' : text)); } catch (e) { return null; }
  if (!o || o.app !== 'customer-note') return null;
  if (typeof o.version === 'number' && o.version > 1) return { tooNew: true };
  if (!o.data || !Array.isArray(o.data.customers)) return null;
  for (var i = 0; i < o.data.customers.length; i++) {
    var c = o.data.customers[i];
    if (!c || typeof c.id !== 'number' || typeof c.name !== 'string') return null;
  }
  return o;
}
function normalizeBackup(envelope, currentSettings, defaultSettings, today) {
  var fallbackDate = (typeof envelope.exportedAt === 'string' && envelope.exportedAt) ? envelope.exportedAt : today;
  var customers = envelope.data.customers.map(function (c) {
    var out = Object.assign({}, c);
    if (typeof out.lastContact !== 'string' || !out.lastContact) out.lastContact = fallbackDate;
    if (!Array.isArray(out.history)) out.history = [];
    return out;
  });
  // 端末ローカルな設定（AI設定・lastBackup・スヌーズ）は現端末値を維持し、followUpDaysのみファイルから
  var settings = Object.assign({}, defaultSettings, currentSettings);
  var fu = envelope.data.settings && envelope.data.settings.followUpDays;
  if (typeof fu === 'number' && fu > 0) settings.followUpDays = fu;
  var maxId = 0;
  for (var i = 0; i < customers.length; i++) if (customers[i].id > maxId) maxId = customers[i].id;
  var nextId = typeof envelope.data.nextId === 'number' ? envelope.data.nextId : 0;
  if (nextId < maxId + 1) nextId = maxId + 1;
  return { customers: customers, settings: settings, nextId: nextId };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildBackupEnvelope: buildBackupEnvelope, backupFilename: backupFilename, validateBackup: validateBackup, normalizeBackup: normalizeBackup };
}
/* BACKUP:END */
```

あわせて `DEFAULT_DATA`（現在の196-200行）を：

```js
const DEFAULT_DATA = {
  customers: [],
  settings: { followUpDays: 14, aiEndpoint: '', aiSecret: '', aiConsent: false, lastBackup: '', reminderSnoozedOn: '' },
  nextId: 1
};
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/backup.test.js`
Expected: PASS（15件）

Run: `node --test tests/parse-card.test.js && node --test tests/gas-helpers.test.js && node --test tests/config-hash.test.js && node --test tests/ai-flow.test.js`
Expected: 既存46件すべてPASS

- [ ] **Step 5: コミット**

```bash
git add tests/backup.test.js customer-note.html
git commit -m "feat(backup): バックアップ純関数（封筒/検証/正規化）＋単体テスト15件"
```

---

### Task 2: 設定画面「データを守る」カード＋書き出し

**Files:**
- Modify: `customer-note.html`（view-settings のHTML、`syncSettingsForm` 付近のJS）

**Interfaces:**
- Consumes: Task 1 の `buildBackupEnvelope` / `backupFilename`
- Produces: `exportBackup()` → Promise<boolean>（成功=true・キャンセル=false。Task 3 の事前バックアップ提案が使う）、`syncBackupStatus(msg)`、設定画面の要素id `backup-status` / `backup-last` / `backup-file-input`

- [ ] **Step 1: UIを追加**

`view-settings` 内、AI説明カード（`「設定リンクをコピー」で…` のカード）の閉じ `</div>` の直後・`view-settings` の閉じ `</div>` の前に：

```html
  <div class="card">
    <div style="font-size:14px; font-weight:600; margin-bottom:8px;">💾 データを守る</div>
    <div class="paste-actions" style="margin-top:0;">
      <button class="btn btn-sm" onclick="exportBackup()">📤 バックアップを保存</button>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('backup-file-input').click()">📥 戻す</button>
      <input type="file" id="backup-file-input" accept=".json,application/json" style="display:none;">
    </div>
    <div id="backup-status" aria-live="polite" style="margin-top:8px; font-size:13px; color:var(--accent); min-height:1.2em;"></div>
    <div id="backup-last" style="margin-top:4px; font-size:12px; color:var(--text-2);"></div>
    <div style="margin-top:8px; font-size:12px; color:var(--text-2); line-height:1.7;">
      お客様のデータをファイルにして手元に残せます。機種変更やデータ消去に備えて、ときどき保存してください。
    </div>
  </div>
```

- [ ] **Step 2: 書き出しJSを実装**

`syncSettingsForm` の直前に追加：

```js
async function exportBackup() {
  const today = todayStr();
  const envelope = buildBackupEnvelope(appData, today);
  const json = JSON.stringify(envelope);
  const fname = backupFilename(today);
  let via = 'download';
  if (navigator.canShare) {
    try {
      const file = new File([json], fname, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        via = 'share';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false; // ユーザーがやめた：何もしない
      via = 'download'; // それ以外の失敗はダウンロードに切替
    }
  }
  if (via === 'download') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  appData.settings.lastBackup = today;
  saveData();
  syncBackupStatus(via === 'share'
    ? '✅ 保存しました'
    : '✅ 保存しました（「ファイル」アプリの「ダウンロード」にあります）');
  renderHome(); // リマインドを消す（Task 4）
  return true;
}

function syncBackupStatus(msg) {
  document.getElementById('backup-status').textContent = msg || '';
  document.getElementById('backup-last').textContent = appData.settings.lastBackup
    ? '最終バックアップ：' + appData.settings.lastBackup
    : '最終バックアップ：まだありません';
}
```

`syncSettingsForm()` の末尾に1行追加：

```js
  syncBackupStatus('');
```

- [ ] **Step 3: 既存テスト全通し＋手動確認**

Run: `node --test tests/backup.test.js`（15件PASS）＋既存4スイート
手動：ローカルHTTPサーバー（`node -e "require('http').createServer((q,s)=>{s.end(require('fs').readFileSync('customer-note.html'))}).listen(8765)"`）でPCブラウザから⚙️→保存→JSONがダウンロードされ中身にaiSecretが無いこと、最終バックアップ日付が出ることを確認。

- [ ] **Step 4: コミット**

```bash
git add customer-note.html
git commit -m "feat(backup): 設定画面「データを守る」カード＋書き出し（共有シート/DLフォールバック）"
```

---

### Task 3: 読み込み（復元）

**Files:**
- Modify: `customer-note.html`（`exportBackup` の下にJS追加、初期化部にリスナー追加）

**Interfaces:**
- Consumes: Task 1 の `validateBackup` / `normalizeBackup`、Task 2 の `exportBackup` / `syncBackupStatus` / `#backup-file-input`

- [ ] **Step 1: 復元JSを実装**

`syncBackupStatus` の下に追加：

```js
async function importBackup(text) {
  const v = validateBackup(text);
  if (v && v.tooNew) { syncBackupStatus('新しい版のバックアップです。アプリを更新してください'); return; }
  if (!v) { syncBackupStatus('このファイルは読み込めませんでした。バックアップファイルか確認してください'); return; }

  // 事前バックアップ提案（今日まだ保存していなければ）
  if (appData.customers.length > 0 && appData.settings.lastBackup !== todayStr()) {
    if (confirm('先に今のデータをバックアップ保存しますか？')) {
      const ok = await exportBackup();
      if (!ok) return; // 保存をやめた＝復元も中断
    }
  }

  const nowN = appData.customers.length;
  const fileN = v.data.customers.length;
  const when = (typeof v.exportedAt === 'string' && v.exportedAt) ? v.exportedAt + 'に保存した' : '';
  let msg = when + 'ファイル（' + fileN + '件）で、今の' + nowN + '件を置き換えます。';
  msg += (nowN > fileN) ? (nowN - fileN) + '件減ります。' : fileN + '件になります。';
  msg += 'よろしいですか？';
  if (!confirm(msg)) return;

  const prev = appData;
  appData = normalizeBackup(v, prev.settings, DEFAULT_DATA.settings, todayStr());
  if (!saveData()) { appData = prev; return; } // 容量超過：元に戻す（saveDataがalert済み）
  syncBackupStatus('✅ ' + fileN + '件を復元しました');
  renderHome();
}
```

- [ ] **Step 2: ファイル選択リスナーを追加**

初期化部（`document.getElementById('reg-photo-input').addEventListener(...)` の後）に：

```js
document.getElementById('backup-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // 同じファイルを2回選べるように
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => syncBackupStatus('ファイルを読めませんでした');
  reader.onload = () => importBackup(reader.result);
  reader.readAsText(file);
});
```

- [ ] **Step 3: 手動確認（往復）**

ローカルサーバーで：数件登録→保存→1件削除→「📥 戻す」→確認文言に日付・件数・「◯件減ります/になります」が出る→復元後に一覧が戻る。壊れたファイル（適当な.json）で「読み込めませんでした」も確認。

- [ ] **Step 4: コミット**

```bash
git add customer-note.html
git commit -m "feat(backup): 復元（2段検査・事前バックアップ提案・件数明示の確認・ロールバック）"
```

---

### Task 4: バックアップリマインド（ホーム画面）

**Files:**
- Modify: `customer-note.html`（view-home のHTML、`renderHome`、JS追加）

**Interfaces:**
- Consumes: `settings.lastBackup` / `settings.reminderSnoozedOn`（Task 1で定義済み）
- Produces: `snoozeBackupReminder(ev)`、要素id `backup-reminder`

- [ ] **Step 1: HTMLを追加**

view-home の検索input（`#home-search`）の直後に：

```html
  <div id="backup-reminder" style="display:none; align-items:center; gap:8px; border:1.5px solid var(--accent-soft); background:var(--accent-soft); border-radius:var(--radius); padding:10px 12px; margin-bottom:14px; font-size:13px;">
    <span onclick="showView('settings')" style="flex:1; cursor:pointer; color:var(--accent);">💾 そろそろバックアップしませんか？（タップで設定へ）</span>
    <span onclick="snoozeBackupReminder(event)" role="button" aria-label="今日は閉じる" style="cursor:pointer; color:var(--text-2); font-size:16px; padding:0 4px;">×</span>
  </div>
```

- [ ] **Step 2: JSを追加**

`renderHome()` の末尾に：

```js
  const s = appData.settings;
  const needReminder = appData.customers.length >= 1 &&
    (!s.lastBackup || daysSince(s.lastBackup) >= 14) &&
    s.reminderSnoozedOn !== todayStr();
  document.getElementById('backup-reminder').style.display = needReminder ? 'flex' : 'none';
```

`snoozeBackupReminder` を `exportBackup` の近くに：

```js
function snoozeBackupReminder(ev) {
  ev.stopPropagation();
  appData.settings.reminderSnoozedOn = todayStr();
  saveData();
  renderHome();
}
```

- [ ] **Step 3: 手動確認**

登録1件以上＋lastBackup未設定→枠が出る／×で消える（リロードしても当日中は出ない）／バックアップ保存すると消える。

- [ ] **Step 4: コミット**

```bash
git add customer-note.html
git commit -m "feat(backup): ホームにバックアップリマインド（14日・当日スヌーズ×）"
```

---

### Task 5: 編集機能

**Files:**
- Modify: `customer-note.html`（view-register のHTML・renderDetail・saveCustomer・photoリスナー・各ガード）

**Interfaces:**
- Consumes: 既存の `resetRegisterForm` / `regPhotoData` / `showView` / `renderDetail` / `renderHome` / `detailId`
- Produces: `editingId`（null=新規／数値=編集中）、`startEdit()`、`openRegister()`、`registerBack()`、`applyRegisterMode()`

- [ ] **Step 1: HTMLに手を入れる**

view-register を編集モード対応にする（4か所）：

1. 戻るリンク：`<span class="back-link" onclick="showView('home')">← もどる</span>` → `<span class="back-link" onclick="registerBack()">← もどる</span>`
2. 見出し：`<h1>お客様を登録</h1>` → `<h1 id="reg-title">お客様を登録</h1>`
3. メモ欄をラップ（編集モードで隠すため）：

```html
    <div id="reg-memo-wrap">
      <label class="field-label">メモ（役職・住所・出会った場所など）</label>
      <textarea id="reg-note" class="field-input" rows="4"></textarea>
    </div>
```

4. 保存ボタン：`<button class="btn" style="width:100%;" onclick="saveCustomer()">保存する</button>` → `<button class="btn" id="reg-save-btn" style="width:100%;" onclick="saveCustomer()">保存する</button>`

さらに view-home のFAB：`onclick="showView('register')"` → `onclick="openRegister()"`

- [ ] **Step 2: モード管理JSを追加**

`let regPhotoData = null;` の近くに：

```js
let editingId = null; // null=新規登録／数値=そのidを編集中

function applyRegisterMode() {
  const edit = editingId !== null;
  document.getElementById('reg-title').textContent = edit ? 'お客様情報を編集' : 'お客様を登録';
  document.getElementById('reg-save-btn').textContent = edit ? '変更を保存' : '保存する';
  document.querySelector('#view-register .ocr-details').style.display = edit ? 'none' : '';
  document.getElementById('reg-memo-wrap').style.display = edit ? 'none' : '';
  if (edit) document.getElementById('reg-ai-wrap').style.display = 'none';
}

function openRegister() {
  if (editingId !== null) { editingId = null; resetRegisterForm(); } // 編集→新規のときだけリセット（下書き温存）
  applyRegisterMode();
  showView('register');
}

function registerBack() {
  if (editingId !== null) {
    editingId = null;
    resetRegisterForm();
    applyRegisterMode();
    showView('detail'); // 編集は詳細に戻る
  } else {
    showView('home'); // 新規は下書きを残したままホームへ
  }
}

function startEdit() {
  const c = appData.customers.find(x => x.id === detailId);
  if (!c) return;
  editingId = c.id;
  resetRegisterForm();
  document.getElementById('reg-name').value = c.name;
  document.getElementById('reg-company').value = c.company || '';
  document.getElementById('reg-phone').value = c.phone || '';
  document.getElementById('reg-email').value = c.email || '';
  if (c.photo) {
    regPhotoData = c.photo;
    const prev = document.getElementById('reg-photo-preview');
    prev.src = c.photo;
    prev.style.display = 'block';
  }
  applyRegisterMode();
  showView('register');
}
```

- [ ] **Step 3: 既存関数に編集分岐とガードを入れる**

1. `renderDetail()` のボタン部分：`✅ 連絡した` ボタンの**前**に追加：

```js
    <button class="btn btn-ghost" style="width:100%; margin-bottom:10px;" onclick="startEdit()">✏️ 編集</button>
```

2. `saveCustomer()` の名前チェック直後に編集分岐を挿入：

```js
function saveCustomer() {
  if (regPhotoBusy) { alert('写真を処理中です。少し待ってからもう一度押してください。'); return; }
  const name = document.getElementById('reg-name').value.trim();
  if (!name) { alert('お名前を入力してください'); return; }
  if (editingId !== null) {
    const c = appData.customers.find(x => x.id === editingId);
    if (!c) { editingId = null; applyRegisterMode(); showView('home'); return; }
    const prev = { name: c.name, company: c.company, phone: c.phone, email: c.email, photo: c.photo };
    c.name = name;
    c.company = document.getElementById('reg-company').value.trim();
    c.phone = document.getElementById('reg-phone').value.trim();
    c.email = document.getElementById('reg-email').value.trim();
    c.photo = regPhotoData;
    if (!saveData()) { Object.assign(c, prev); return; } // 容量超過：変更前に戻す
    editingId = null;
    resetRegisterForm();
    applyRegisterMode();
    renderDetail();
    renderHome();
    showView('detail');
    return;
  }
  // ↓ 以降は既存の新規登録処理そのまま
```

3. `runAiRead()`・`runParse()`・`clearPaste()` の各先頭に1行：

```js
  if (editingId !== null) return; // 編集モードでは使わない
```

4. photo changeリスナー内のAIボタン表示行を差し替え：

```js
    document.getElementById('reg-ai-wrap').style.display = (editingId === null && navigator.onLine) ? 'block' : 'none';
```

- [ ] **Step 4: テスト全通し＋手動確認**

Run: 全5スイート（46＋15件PASS）
手動（ローカルサーバー）：
- 詳細→✏️編集→値がプリセット・OCR/AI/メモ欄が見えない→名前を変えて「変更を保存」→詳細と一覧の両方が新しい名前
- 編集中に「← もどる」→詳細に戻る・変更が捨てられている
- 編集の直後にFABで新規→フォームが空・見出し「お客様を登録」・ボタン「保存する」
- 新規で途中まで入力→もどる→FAB→入力が残っている（下書き温存）
- 編集で写真を選び直してもAIボタンが出ない

- [ ] **Step 5: コミット**

```bash
git add customer-note.html
git commit -m "feat(edit): お客様情報の編集（モード切替・下書き温存・AI/OCRガード・容量ロールバック）"
```

---

### Task 6: 総合検証・同期・公開

**Files:**
- Modify: `index.html`（customer-note.html のコピー）、`CLAUDE.md`（テスト数・機能の記載更新）

- [ ] **Step 1: 全テスト実行**

```bash
node --test tests/parse-card.test.js
node --test tests/gas-helpers.test.js
node --test tests/config-hash.test.js
node --test tests/ai-flow.test.js
node --test tests/backup.test.js
```

Expected: 61件すべてPASS（fail 0）

- [ ] **Step 2: app-verify スキルで公開前チェック**

app-verify のチェックリストに従い、ローカルHTTPサーバー経由の実ブラウザ確認＋秘密情報スキャン（実キー・実URL・合言葉の値の混入がないこと）。

- [ ] **Step 3: index.html 同期＋CLAUDE.md 更新**

```powershell
copy customer-note.html index.html
```

`CLAUDE.md` のテスト欄に `node --test tests/backup.test.js  # バックアップ 15` を追記し、概要に「バックアップ・編集機能あり」を反映。

- [ ] **Step 4: コミット＆push**

```bash
git add -A
git commit -m "chore: index.html同期＋CLAUDE.md更新（バックアップ＋編集機能）"
git push
```

pre-pushフック（秘密スキャン・同期チェック）が通ることを確認。

- [ ] **Step 5: 公開URLで最終確認**

https://cmkurashikibranch.github.io/customer-note/ をスマホで開き、⚙️に「💾 データを守る」が出ること・共有シートでの保存を実機確認（共有後のファイル名化けもここで見る）。
