# お客様ノート ステップ1（写真＋手入力版）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 名刺撮影＋手入力で顧客台帳・フォローアップ管理ができる単一HTMLアプリ `customer-note.html` を作る。

**Architecture:** 単一HTMLファイル（CSS・JSインライン）＋localStorage。3画面（ホーム/登録/詳細）をJSで切替するSPA。サーバー・ビルド・外部ライブラリなし。テストは各タスクごとにブラウザ（Playwright MCPまたは手動）で動作確認する。

**Tech Stack:** Vanilla HTML/CSS/JS、localStorage、Canvas API（画像縮小）

**作業ディレクトリ:** `C:\Users\kkmh2\claude\名刺顧客管理`

---

## File Structure

| ファイル | 責務 |
|---------|------|
| `customer-note.html` | アプリ全体（唯一の成果物） |

HTML内の構成（上から順）：
1. `<style>` — CSS変数・3画面のスタイル
2. `<div id="view-home">` / `<div id="view-register">` / `<div id="view-detail">` — 3画面
3. `<script>` — ストレージ層 → 画像処理 → 各画面レンダリング → イベントハンドラー → init

---

### Task 1: HTMLスケルトン＋デザイントークン＋画面切替

**Files:**
- Create: `customer-note.html`

- [ ] **Step 1: ファイル作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>お客様ノート</title>
<style>
  :root {
    --bg: #F8FAFC;
    --card: #FFFFFF;
    --accent: #2563EB;
    --accent-soft: #EFF6FF;
    --text: #0F172A;
    --text-2: #64748B;
    --radius: 16px;
    --shadow: 0 1px 3px rgba(15,23,42,0.08);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
    max-width: 480px;
    margin: 0 auto;
    padding: 16px;
    padding-bottom: 90px;
  }
  h1 { font-size: 20px; margin-bottom: 16px; }
  .view { display: none; }
  .view.active { display: block; }
  .card {
    background: var(--card);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 14px 16px;
    margin-bottom: 10px;
  }
  .btn {
    display: inline-block;
    border: none;
    border-radius: 12px;
    padding: 12px 20px;
    font-size: 15px;
    cursor: pointer;
    background: var(--accent);
    color: #fff;
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-2);
    border: 1px solid #E2E8F0;
  }
  .back-link {
    color: var(--text-2);
    cursor: pointer;
    font-size: 14px;
    margin-bottom: 12px;
    display: inline-block;
  }
</style>
</head>
<body>

<div id="view-home" class="view active">
  <h1>お客様ノート</h1>
</div>

<div id="view-register" class="view">
  <span class="back-link" onclick="showView('home')">← もどる</span>
  <h1>お客様を登録</h1>
</div>

<div id="view-detail" class="view">
  <span class="back-link" onclick="showView('home')">← もどる</span>
</div>

<script>
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  window.scrollTo(0, 0);
}
</script>
</body>
</html>
```

- [ ] **Step 2: ブラウザで確認**

`customer-note.html` をブラウザで開き、ホーム画面のタイトルが表示されること、DevToolsコンソールで `showView('register')` → 登録画面に切り替わることを確認。

- [ ] **Step 3: Commit**

```bash
git add customer-note.html
git commit -m "feat: HTMLスケルトン・デザイントークン・画面切替"
```

---

### Task 2: ストレージ層

**Files:**
- Modify: `customer-note.html`（`<script>` 内、`showView` の前）

- [ ] **Step 1: ストレージ関数を追加**

```js
const STORAGE_KEY = 'customer-note-v1';

const DEFAULT_DATA = {
  customers: [],
  settings: { followUpDays: 14 },
  nextId: 1
};

let appData = null;

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_DATA);
    const parsed = JSON.parse(raw);
    return Object.assign(structuredClone(DEFAULT_DATA), parsed);
  } catch (e) {
    console.error('loadData failed', e);
    return structuredClone(DEFAULT_DATA);
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    return true;
  } catch (e) {
    // QuotaExceededError 等
    alert('保存に失敗しました。容量がいっぱいの可能性があります。古いお客様の写真を削除してください。');
    return false;
  }
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
```

`<script>` の末尾に初期化を追加：

```js
appData = loadData();
```

- [ ] **Step 2: ブラウザで確認**

コンソールで `appData` → デフォルト構造が返ること。`appData.customers.push({id:1,name:'テスト'}); saveData();` → リロード後も `appData.customers` に残ること。確認後 `localStorage.removeItem('customer-note-v1')` でクリア。

- [ ] **Step 3: Commit**

```bash
git add customer-note.html
git commit -m "feat: localStorageストレージ層（try/catch付き）"
```

---

### Task 3: 登録画面（写真撮影・縮小圧縮・フォーム・保存）

**Files:**
- Modify: `customer-note.html`

- [ ] **Step 1: 登録画面のHTMLを差し替え**

`#view-register` の中身（h1の下）に追加：

```html
<div class="card" style="text-align:center;">
  <img id="reg-photo-preview" style="display:none; width:100%; border-radius:12px; margin-bottom:8px;">
  <label class="btn btn-ghost" style="display:block;">
    📷 名刺を撮る・選ぶ
    <input type="file" id="reg-photo-input" accept="image/*" capture="environment" style="display:none;">
  </label>
  <!-- 将来のOCR/AIボタン差し込み位置 -->
</div>
<div class="card">
  <label class="field-label">お名前 *</label>
  <input type="text" id="reg-name" class="field-input" placeholder="山田 太郎">
  <label class="field-label">会社・屋号</label>
  <input type="text" id="reg-company" class="field-input">
  <label class="field-label">電話番号</label>
  <input type="tel" id="reg-phone" class="field-input">
  <label class="field-label">メール</label>
  <input type="email" id="reg-email" class="field-input">
  <label class="field-label">メモ（出会った場所など）</label>
  <textarea id="reg-note" class="field-input" rows="2"></textarea>
</div>
<button class="btn" style="width:100%;" onclick="saveCustomer()">保存する</button>
```

`<style>` に追加：

```css
.field-label { display:block; font-size:12px; color:var(--text-2); margin:10px 0 4px; }
.field-input {
  width:100%; padding:10px 12px; font-size:15px;
  border:1px solid #E2E8F0; border-radius:10px;
  background:#FBFCFE; color:var(--text);
}
.field-input:focus { outline:2px solid var(--accent); border-color:transparent; }
```

- [ ] **Step 2: 画像縮小＋保存ロジックを追加**

`<script>` に追加：

```js
let regPhotoData = null; // base64 or null

function resizeImage(file, callback) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const MAX = 800;
    let { width, height } = img;
    if (Math.max(width, height) > MAX) {
      const scale = MAX / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    callback(canvas.toDataURL('image/jpeg', 0.7));
  };
  img.onerror = () => { URL.revokeObjectURL(url); alert('画像を読み込めませんでした'); };
  img.src = url;
}

document.getElementById('reg-photo-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  resizeImage(file, (dataUrl) => {
    regPhotoData = dataUrl;
    const prev = document.getElementById('reg-photo-preview');
    prev.src = dataUrl;
    prev.style.display = 'block';
  });
});

function resetRegisterForm() {
  regPhotoData = null;
  const prev = document.getElementById('reg-photo-preview');
  prev.style.display = 'none';
  prev.src = '';
  ['reg-name','reg-company','reg-phone','reg-email','reg-note'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('reg-photo-input').value = '';
}

function saveCustomer() {
  const name = document.getElementById('reg-name').value.trim();
  if (!name) { alert('お名前を入力してください'); return; }
  const note = document.getElementById('reg-note').value.trim();
  const customer = {
    id: appData.nextId++,
    name,
    company: document.getElementById('reg-company').value.trim(),
    phone: document.getElementById('reg-phone').value.trim(),
    email: document.getElementById('reg-email').value.trim(),
    photo: regPhotoData,
    lastContact: todayStr(),
    history: [{ date: todayStr(), note: note || '登録' }]
  };
  appData.customers.push(customer);
  if (!saveData()) { appData.customers.pop(); appData.nextId--; return; }
  resetRegisterForm();
  renderHome();
  showView('home');
}
```

- [ ] **Step 3: ブラウザで確認**

登録画面で画像を選択 → プレビュー表示。名前未入力で保存 → アラート。名前入力して保存 → ホームに戻り、コンソールで `appData.customers` に1件入っていること、photoが `data:image/jpeg` で始まり概ね100KB未満であること。

- [ ] **Step 4: Commit**

```bash
git add customer-note.html
git commit -m "feat: 登録画面（写真縮小圧縮・フォーム・保存）"
```

---

### Task 4: ホーム画面（リスト・検索・フォローアップ枠）

**Files:**
- Modify: `customer-note.html`

- [ ] **Step 1: ホームHTMLを差し替え**

`#view-home` の中身：

```html
<h1>お客様ノート</h1>
<input type="search" id="home-search" class="field-input" placeholder="🔍 名前・会社で検索" style="margin-bottom:14px;">
<div id="followup-section" style="display:none;">
  <div style="font-size:13px; color:var(--accent); margin-bottom:6px;">💬 そろそろ連絡しませんか？</div>
  <div id="followup-list" style="border:1.5px solid var(--accent-soft); background:var(--accent-soft); border-radius:var(--radius); padding:8px; margin-bottom:16px;"></div>
</div>
<div style="font-size:13px; color:var(--text-2); margin-bottom:6px;">みなさん</div>
<div id="customer-list"></div>
<div id="empty-message" style="display:none; text-align:center; color:var(--text-2); padding:40px 0;">
  まだ登録がありません。<br>下のボタンから名刺を撮ってみましょう。
</div>
<button class="btn" id="fab" onclick="showView('register')">📷 名刺を撮る</button>
```

`<style>` に追加：

```css
#fab {
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
  box-shadow: 0 4px 12px rgba(37,99,235,0.35); z-index: 10;
}
.cust-row { display:flex; align-items:center; gap:12px; cursor:pointer; }
.cust-thumb {
  width:48px; height:48px; border-radius:10px; object-fit:cover;
  background:var(--accent-soft); flex-shrink:0;
  display:flex; align-items:center; justify-content:center; font-size:20px;
}
.cust-name { font-size:15px; font-weight:600; }
.cust-sub { font-size:12px; color:var(--text-2); }
```

- [ ] **Step 2: レンダリングJSを追加**

```js
function daysSince(dateStr) {
  return Math.floor((new Date(todayStr()) - new Date(dateStr)) / 86400000);
}

function customerCard(c) {
  const thumb = c.photo
    ? `<img class="cust-thumb" src="${c.photo}" alt="">`
    : `<div class="cust-thumb">👤</div>`;
  const days = daysSince(c.lastContact);
  const sub = [c.company, days === 0 ? '今日連絡' : days + '日前に連絡'].filter(Boolean).join('・');
  return `<div class="card cust-row" onclick="openDetail(${c.id})">
    ${thumb}
    <div><div class="cust-name">${escapeHtml(c.name)}さん</div>
    <div class="cust-sub">${escapeHtml(sub)}</div></div>
  </div>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function renderHome() {
  const q = document.getElementById('home-search').value.trim().toLowerCase();
  const all = appData.customers.filter(c =>
    !q || c.name.toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q));

  const followUps = all.filter(c => daysSince(c.lastContact) >= appData.settings.followUpDays);
  const section = document.getElementById('followup-section');
  section.style.display = followUps.length ? 'block' : 'none';
  document.getElementById('followup-list').innerHTML = followUps.map(customerCard).join('');

  const sorted = [...all].sort((a, b) => b.lastContact.localeCompare(a.lastContact));
  document.getElementById('customer-list').innerHTML = sorted.map(customerCard).join('');
  document.getElementById('empty-message').style.display =
    appData.customers.length ? 'none' : 'block';
}

document.getElementById('home-search').addEventListener('input', renderHome);
```

初期化部を更新：

```js
appData = loadData();
renderHome();
```

`openDetail` はTask 5で実装するため、暫定スタブを置く：

```js
function openDetail(id) { /* Task 5 で実装 */ }
```

- [ ] **Step 3: ブラウザで確認**

登録0件 → 空メッセージ表示。1件登録 → リストに「〜さん」表示。コンソールで `appData.customers[0].lastContact = '2026-05-01'; saveData(); renderHome();` → フォローアップ枠に浮上。検索バーで名前の一部 → 絞り込み。

- [ ] **Step 4: Commit**

```bash
git add customer-note.html
git commit -m "feat: ホーム画面（リスト・検索・フォローアップ枠）"
```

---

### Task 5: 詳細画面（写真拡大・tel/mailto・連絡したボタン・履歴）

**Files:**
- Modify: `customer-note.html`

- [ ] **Step 1: 詳細HTMLを差し替え**

`#view-detail` の中身（back-linkの下）：

```html
<div id="detail-content"></div>
<div id="photo-modal" onclick="this.style.display='none'"
  style="display:none; position:fixed; inset:0; background:rgba(15,23,42,0.9); z-index:100; align-items:center; justify-content:center; padding:16px;">
  <img id="photo-modal-img" style="max-width:100%; max-height:90vh; border-radius:8px;">
</div>
```

- [ ] **Step 2: 詳細レンダリングJSを追加（スタブを置き換え）**

```js
let detailId = null;

function openDetail(id) {
  detailId = id;
  renderDetail();
  showView('detail');
}

function renderDetail() {
  const c = appData.customers.find(x => x.id === detailId);
  if (!c) { showView('home'); return; }
  const photo = c.photo
    ? `<img src="${c.photo}" onclick="openPhotoModal()" style="width:100%; border-radius:12px; cursor:zoom-in;">`
    : '';
  const contacts = [
    c.phone ? `<a class="btn btn-ghost" href="tel:${escapeHtml(c.phone)}">📞 電話する</a>` : '',
    c.email ? `<a class="btn btn-ghost" href="mailto:${escapeHtml(c.email)}">✉️ メールする</a>` : ''
  ].filter(Boolean).join(' ');
  const history = [...c.history].reverse().map(h =>
    `<div style="padding:8px 0; border-bottom:1px solid #F1F5F9;">
      <div style="font-size:12px; color:var(--text-2);">${h.date}</div>
      <div style="font-size:14px;">${escapeHtml(h.note)}</div>
    </div>`).join('');
  document.getElementById('detail-content').innerHTML = `
    <div class="card">
      ${photo}
      <h1 style="margin:10px 0 2px;">${escapeHtml(c.name)}さん</h1>
      <div class="cust-sub">${escapeHtml(c.company || '')}</div>
      <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">${contacts}</div>
    </div>
    <button class="btn" style="width:100%; margin-bottom:10px;" onclick="markContacted()">✅ 連絡した</button>
    <div class="card">
      <div style="font-size:13px; color:var(--text-2); margin-bottom:4px;">やりとり履歴</div>
      ${history || '<div class="cust-sub">まだ履歴がありません</div>'}
    </div>
    <button class="btn btn-ghost" style="width:100%; margin-top:6px;" onclick="deleteCustomer()">このお客様を削除</button>`;
}

function openPhotoModal() {
  const c = appData.customers.find(x => x.id === detailId);
  if (!c || !c.photo) return;
  document.getElementById('photo-modal-img').src = c.photo;
  document.getElementById('photo-modal').style.display = 'flex';
}

function markContacted() {
  const c = appData.customers.find(x => x.id === detailId);
  if (!c) return;
  const note = prompt('どんなやりとりでしたか？（空欄でもOK）') ;
  if (note === null) return; // キャンセル
  c.history.push({ date: todayStr(), note: note.trim() || '連絡した' });
  c.lastContact = todayStr();
  saveData();
  renderDetail();
  renderHome();
}

function deleteCustomer() {
  const c = appData.customers.find(x => x.id === detailId);
  if (!c) return;
  if (!confirm(c.name + 'さんを削除します。よろしいですか？')) return;
  appData.customers = appData.customers.filter(x => x.id !== detailId);
  saveData();
  renderHome();
  showView('home');
}
```

- [ ] **Step 3: ブラウザで確認**

リストのカードをタップ → 詳細表示。写真タップ → 拡大モーダル、背景タップで閉じる。「✅連絡した」→ メモ入力 → 履歴に追加・最終連絡日が今日になりホームの表示も更新。削除 → 確認ダイアログ → リストから消える。

- [ ] **Step 4: Commit**

```bash
git add customer-note.html
git commit -m "feat: 詳細画面（写真拡大・連絡履歴・削除）"
```

---

### Task 6: 容量警告＋総合動作確認

**Files:**
- Modify: `customer-note.html`

- [ ] **Step 1: 容量チェックを追加**

`saveCustomer()` の `saveData()` 成功後（`resetRegisterForm()` の前）に追加：

```js
  const used = JSON.stringify(appData).length;
  if (used > 4 * 1024 * 1024) {
    alert('保存容量が残りわずかです（約' + Math.round(used / 1024 / 1024 * 10) / 10 + 'MB使用中）。古いお客様を削除すると空きが増えます。');
  }
```

- [ ] **Step 2: 総合動作確認（Playwright MCPまたは手動）**

1. localStorageをクリアして新規状態から：登録 → ホーム表示 → 詳細 → 連絡した → 削除 の一連フロー
2. 写真なし登録（👤アイコン表示）
3. 検索の絞り込み・解除
4. リロード後のデータ永続化
5. スマホ幅（375px）でレイアウト崩れがないこと

- [ ] **Step 3: Commit**

```bash
git add customer-note.html
git commit -m "feat: 容量警告を追加・総合動作確認完了"
```
