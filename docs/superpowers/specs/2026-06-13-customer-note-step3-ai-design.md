# お客様ノート 設計書（ステップ3：AI自動読取・GAS経由）

作成日：2026-06-13
ステータス：**v1 — UI/UX・エンジニア2レビュー反映済み（承認待ち）**
前提：ステップ1（写真＋手入力）・ステップ2（OCR貼り付け＋自動振り分け）完了済み（`customer-note.html`）

## 目的と位置づけ

名刺の**写真そのもの**を Claude（Haiku・Vision）に読ませ、`{name, company, phone, email, memo}` に自動振り分けする。
APIキーを守るため **GAS（Google Apps Script）を中継**させ、キーはGASのスクリプトプロパティだけに置く。
これがステップ計画のゴール。守成クラブで「DXが得意な人」と覚えてもらうデモの中核機能。

| ステップ | 入力方式 | API | 状態 |
|---------|---------|-----|------|
| 1 | 写真＋手入力 | 不要 | 完了 |
| 2 | スマホOCR貼り付け＋自動振り分け | 不要 | 完了 |
| 3 | **AI自動読取（Claude Haiku・GAS経由）** | 約0.3円/枚 | **本設計書の対象** |

データの流れ：

```
┌ お客様ノート（GitHub Pages・公開・単一HTML）──────────┐
│  登録画面                                                │
│   [📷 名刺を撮る] → regPhotoData (JPEG/base64・既存)      │
│   [🤖 AIで読み取る] ← 追加（押した時だけ・写真がある時だけ）│
│        │ fetch POST (text/plain)  body:{image, secret}   │
│   ⚙️設定: aiEndpoint / aiSecret（localStorage・公開コードに出さない）│
└────────┼─────────────────────────────────────────┘
         │ {image(dataURL), secret}
         ▼
┌ GAS Web App（オーナーのGoogleアカウント・専用URL・Anyone公開）┐
│  doPost():                                                  │
│   1. secret照合（不一致→拒否）                               │
│   2. 画像バイト上限チェック（巨大画像を弾く）                  │
│   3. 1日上限チェック（LockServiceで保護）                     │
│   4. dataURLからmedia_type抽出＋base64接頭辞を剥がす          │
│   5. Claude APIへ中継（x-api-keyはScript Propertiesのみ）      │
│   6. stop_reason検査＋JSON.parse（try/catch）                │
│   7. 必ず固定形 {ok,data} / {ok,error} で返す                 │
└────────┼─────────────────────────────────────────┘
         │ x-api-key（秘匿）/ anthropic-version
         ▼
┌ Claude API（claude-haiku-4-5・Vision・構造化出力）──────┐
│  名刺画像を読み {name,company,phone,email,memo} を返す      │
└──────────────────────────────────────────────────┘
```

結果の形 `{name, company, phone, email, memo}` は**ステップ2と完全に同じ**。反映・確認・保存はステップ2の仕組みを共通化して再利用する。

## スコープ

| やること | やらないこと |
|---------|-------------|
| 写真→[🤖AIで読み取る]ボタン（押下時のみ・追加） | 写真撮影での自動実行（必ず手動） |
| GAS中継（新規 `gas/Code.gs`） | APIキーのクライアント保管 |
| 設定画面（aiEndpoint/aiSecret）＋QR/hashでの設定受け渡し | データ構造の変更 |
| 1日上限・画像バイト上限・合言葉トークン・疎通ping | 複数枚一括読取 |
| 反映関数の共通化（OCRとAIで共用・source対応） | アプリ内OCR（Tesseract等） |
| 失敗時は手入力/OCRへやさしく誘導 | 別の確認画面の新設 |

- **いじるのは登録画面まわり＋設定画面の新設＋GAS新規**。保存ロジック・データ構造は据え置き。
- ステップ1（手入力）・ステップ2（OCR貼り付け）は**そのまま残す**（オフライン/失敗時の保険）。
- **AI機能はネット必須だが、AIボタンを押さない限り `fetch` は走らない** → 未使用時のオフライン動作を維持する。

## セキュリティ設計（多層防御）

GitHub Pages（公開リポジトリ）でホスティングするため、コミットした内容は全部公開される前提で守る。

1. **入口URLを公開コードに書かない**：GASのURLはアプリ本体に埋め込まず、設定（localStorage）に保存。GASは「Anyone（Googleログイン不要）」公開だが、URLを知らなければ叩けない。
2. **合言葉トークン（aiSecret）**：URL秘匿に加えて第2の関門。クライアントは body に `secret` を入れて送り、GASは Script Properties の `APP_SECRET` と照合、不一致なら即拒否。URLだけ漏れても、合言葉を差し替えるだけで無効化できる。
   - **トークンは HTTPヘッダではなく body に入れる**（カスタムヘッダはCORSプリフライトを誘発するため／後述）。
3. **1日上限（maxPerDay=50・CONFIG）**：`PropertiesService` に日付キー `count_YYYY-MM-DD` で枚数記録。`LockService.getScriptLock()` で read-modify-write を保護（同時実行の競合防止）。漏れても青天井課金にならない安全弁。
4. **画像バイト上限（maxImageBytes）**：`doPost` 冒頭で本文長から元バイト数を概算し、上限超過は Claude に渡す前に弾く（巨大画像でのコスト/実行時間攻撃を防ぐ）。目安 base64で 1.5MB（≒元1.1MB）。
5. **APIキーは Script Properties の `ANTHROPIC_API_KEY` のみ**。GASコード本体・アプリ本体・公開リポジトリのどこにも出さない（GASコード自体は公開OK）。

## セットアップとURL受け渡し

### 前提（セットアップ手順書で案内）

1. **Anthropic APIキー＋支払い設定**（オーナーのアカウント・利用に応じた課金が発生）。
2. **GASプロジェクト作成** → `gas/Code.gs` を貼り付け → Script Properties に `ANTHROPIC_API_KEY` と `APP_SECRET` を登録 → Web App として「自分として実行・Anyone がアクセス」でデプロイ → `/exec` URL を取得。
3. URL と合言葉をアプリの設定に登録（下記QR or 手貼り）。

### QR/hash による設定受け渡し（デモ初期設定をゼロ入力に）

長いGAS URLをスマホで手貼りさせるのは現実的に失敗する。**QRを読むだけで設定完了**にする。

- 設定リンク形式：`https://cmkurashikibranch.github.io/customer-note/#cfg=<base64url(JSON.stringify({u:endpoint, s:secret}))>`
- アプリは**起動時に `location.hash` を検査**。`#cfg=` で始まれば decode → `settings.aiEndpoint` / `settings.aiSecret` を保存 → `history.replaceState()` で **hashを即削除**（URLは公開HTMLに残らない）→「✅ AI読み取りの設定が完了しました」を表示。
- **設定済みのオーナー端末は、自分の設定をQRで表示できる**（「この設定をQRで渡す」ボタン）。相手はカメラで読むだけ。QR描画は単一HTML・オフライン維持のため**極小QR生成ライブラリをインライン同梱（vendored）**する（外部CDN読み込みはしない）。
- 合言葉（s）はQR（対面・口頭で渡す）に乗るだけで、公開コードには出ない。

### 設定画面 `#view-settings`（ホームに⚙️・再設定/手動用）

- フィールド：`AI読み取りサーバーURL`（aiEndpoint）／`合言葉`（aiSecret）。長文ペースト前提で trim・前後空白/改行除去。
- 保存時に**その場で疎通ping**（後述）→「✅ つながりました」/「✗ つながりません（URL・合言葉をご確認ください）」を即時表示。
- **本日の残り回数**を表示（例「本日 12/50 枚」「明日0時（JST）にリセット」）。
- 「この設定をQRで渡す」ボタン（上記）。

## GAS中継（新規 `gas/Code.gs`）

公開リポジトリに置く（キーはコードに書かない）。既存LINEシステムの `CONFIG`/`UrlFetchApp`/`PropertiesService` パターンを踏襲。

### CONFIG

```javascript
var CONFIG = {
  model: 'claude-haiku-4-5',        // ← 精度不足ならここ1行で 'claude-sonnet-4-6' 等に変更
  maxTokens: 1024,                  // 構造化出力＋日本語memoで512は危険。1024。
  maxPerDay: 50,                    // 1日の読取上限（枚）
  maxImageBytes: 1.5 * 1024 * 1024, // base64本文長の上限（巨大画像を弾く）
  anthropicVersion: '2023-06-01'
};
```

Script Properties：`ANTHROPIC_API_KEY` / `APP_SECRET`。

### `doPost(e)` の流れ（一本化・action分岐）

body（`e.postData.contents` を JSON.parse）：
- `{ action:'ping', secret }` → 疎通確認。secret照合のみ行い `{ ok:true, remaining: <残り回数> }` を返す（Claudeは呼ばない＝無料）。
- `{ image:<dataURL>, secret }` → AI読取本体。

AI読取本体の手順：
1. `secret` を `APP_SECRET` と照合。不一致 → `{ok:false, error:'auth'}`。
2. `image` 本文長 > `maxImageBytes` → `{ok:false, error:'bad_image'}`。
3. `LockService` で囲んで当日カウンタを get → `>= maxPerDay` なら `{ok:false, error:'limit'}`、未満なら +1 して set。
4. dataURL（`data:image/jpeg;base64,XXXX`）から **media_type を抽出**し、**base64接頭辞を剥がす**（剥がす責務はGAS側に固定。クライアントは生のdataURLを送る）。
5. Claude API へ `UrlFetchApp.fetch(..., { muteHttpExceptions:true })`（下記ペイロード）。
6. `getResponseCode()` で分岐：401→`auth`／429・529・5xx→`upstream`／200→次へ。
7. レスポンスの `stop_reason` が `refusal` → `{ok:false,error:'refusal'}`、`max_tokens` → `{ok:false,error:'upstream'}`（途中で切れたJSONは捨てる）。
8. 構造化出力の本文テキスト（`content[0].text`）を **try/catch で JSON.parse**。失敗 → `{ok:false,error:'parse'}`。
9. 成功 → `{ ok:true, data:{name,company,phone,email,memo}, remaining:<残り> }`。
10. 返却は `ContentService.createTextOutput(JSON.stringify(...)).setMimeType(ContentService.MimeType.JSON)`。

**クライアントは必ずこの固定形だけを期待する**ので、上流が何を返してもアプリが例外で落ちない。

### Claude APIペイロード（検証済み事実に準拠）

```json
{
  "model": "claude-haiku-4-5",
  "max_tokens": 1024,
  "messages": [{
    "role": "user",
    "content": [
      { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "<接頭辞を剥がしたbase64>" } },
      { "type": "text", "text": "この名刺画像から name(氏名) / company(会社名・屋号) / phone(電話番号・番号のみ) / email / memo(役職・住所・FAX等) を抽出してJSONで返してください。読み取れない項目は空文字。電話とFAXが両方あれば電話をphone、FAXはmemoへ。" }
    ]
  }],
  "output_config": {
    "format": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "properties": {
          "name":    { "type": "string", "description": "氏名" },
          "company": { "type": "string", "description": "会社名・屋号" },
          "phone":   { "type": "string", "description": "電話番号（番号のみ）" },
          "email":   { "type": "string", "description": "メールアドレス" },
          "memo":    { "type": "string", "description": "役職・住所・FAXなど補足" }
        },
        "required": ["name", "company", "phone", "email", "memo"],
        "additionalProperties": false
      }
    }
  }
}
```

ヘッダ：`x-api-key`（Script Property）／`anthropic-version: 2023-06-01`／`content-type: application/json`。
- スキーマは**完全フラット・全項目string・5項目すべて required・長さ/数値制約なし**（構造化出力の仕様制約に準拠）。空欄は空文字で返させる。
- `thinking`/`effort` は**送らない**（Haiku 4.5は非対応・このタスクに不要）。
- 初回スキーマコンパイルに数秒の遅延あり（24時間キャッシュ）→ クライアントのタイムアウトは長めに（後述）。

### クライアント↔GAS の通信作法（CORS）

- `fetch(aiEndpoint, { method:'POST', body: JSON.stringify({ image, secret }) })`。**`headers`/`mode` を明示しない**（既定 `Content-Type: text/plain;charset=UTF-8` の単純リクエスト＝**プリフライトを回避**）。
- カスタムヘッダ（`X-App-Secret` 等）は**付けない**（プリフライトが発生して詰む）。secretは body に入れる。
- GASの `/exec` は 302 → `script.googleusercontent.com` へリダイレクト。`fetch` は既定 `redirect:'follow'` で追従し、最終応答に `Access-Control-Allow-Origin: *` が付く。
- 画像（dataURL）と secret はすべて body のJSONに入れる。

## クライアント変更

### 登録画面 `#view-register`：入力経路を主従に再設計

3経路（手入力・OCR貼付・AI）が同列に並ぶと迷う。**AIを主役**にし、OCRと手入力は格下げする。

```
┌─ お客様を登録 ───────────────────┐
│ [ 名刺写真プレビュー ]                  │
│ [📷 名刺を撮る・選ぶ]                   │  ← 既存
│ ┌──────────────────────────┐  │
│ │ 🤖 AIで読み取る  （約0.3円）         │  │ ← 写真がある時だけ表示。主ボタン
│ └──────────────────────────┘  │   押下→「⏳ 読み取り中…数秒かかります」
│ ▸ うまく撮れない時：文字を貼り付けて読み取る  │ ← OCR(step2)を <details> に格納
│ ─────────────────────────────  │
│ お名前*  [        ] ｢推測｣              │ ← AI/OCRが入れた欄に推測タグ
│ 会社     [        ] ｢推測｣              │
│ 電話     [        ] ｢要確認｣            │ ← AI時は電話・メールにも要確認タグ
│ メール   [        ] ｢要確認｣            │
│ メモ（役職・住所・出会った場所など）        │
│ [ 保存する ]                            │
└────────────────────────────────┘
```

- **🤖AIボタンは写真があるときだけ表示**（無い間は出さない＝迷わせない）。`📷`(撮影)と区別するため絵文字は`🤖`。
- **OCR貼り付けカード（step2）は `<details>` で畳む**（「うまく撮れない時はこちら」）。手入力は最終手段としてフォームに残す。
- **読み取り中の体験**：押下でボタンを `⏳ 読み取り中…（数秒かかります）` に差し替え＋スピナー、`aiBusy` で多重発火防止。完了で対象欄を**順にフラッシュ**（名前→会社→電話→メール、0.3秒スタガ＝デモ映えの核）。
- **タイムアウト**：`AbortController` で **20秒**。超過は「時間がかかっています。手入力かOCRに切り替えますか？」。`finally` で必ず `aiBusy` 解除。
- **ガード**：写真未取得（`regPhotoData==null`）→「先に名刺を撮ってください」。写真処理中（`regPhotoBusy`）→弾く。`aiEndpoint` 未設定→「⚙️設定でAI読み取りを登録してください」。`navigator.onLine===false` ならボタン無効化（押す前に止める）。

### 反映の共通化（OCRとAIで共用・source対応）

ステップ2の `runParse` の反映部分を共通関数に切り出す：

```
applyParsed(result, source)   // result = {name,company,phone,email,memo}, source = 'ocr' | 'ai'
```

- 反映ルールは共通：**非空の項目だけ上書き**、**メモは追記マージ**（既存の手入力・「守成クラブで交換」等は消さない）、改行保持。
- **推測/要確認マーカーの範囲は source で変える（UX/エンジニアレビューの折衷）**：
  - `source==='ocr'`：name / company に「推測」（＝従来どおり。電話・メールは正規表現で確実抽出なのでマーカー無し）。
  - `source==='ai'`：**name / company に「推測」、phone / email に「要確認」**（AIは桁・@前後・全角を読み違えうるため）。phone/email 入力欄にも guess-tag/`.guessed` 相当を追加する。
- 編集 or 保存でマーカー解除（既存挙動を踏襲）。
- 状態メッセージは **step2の常駐ステータス領域（`#reg-paste-status` 相当）を共通化**して同じ場所・同じ見た目で出す（alert乱発しない）。AI時は「✨読み取りました。番号・メールは念のためご確認ください」。

### 初回プライバシー同意（信頼＝DX印象に直結）

- AI読取の**初回だけ**「名刺写真をAIに送って読み取ります（保存はこの端末だけ）」を1回確認。`settings` に同意フラグを持つ。

### データ構造（変更なし）／DEFAULT_DATA更新

ステップ1・2と同一。`settings` に既定値を追加するのみ（`loadData` のマージ式が吸収）。

```javascript
DEFAULT_DATA.settings = { followUpDays: 14, aiEndpoint: '', aiSecret: '', aiConsent: false };
```

`saveData`・容量警告・`loadData` マージは不変。設定値は短文で容量に影響なし。マイグレーション不要。

## 失敗時の動き（全部やさしく手入力/OCRへ）

| `error` / 状況 | アプリの文言（例） | 誘導 |
|---------------|------------------|------|
| URL未設定 | ⚙️設定でAI読み取りを登録してください | 設定へ |
| 写真がまだ | 先に名刺の写真を撮ってください | — |
| `auth` | サーバー側の設定（合言葉）をご確認ください | 設定へ |
| `bad_image` | 画像が大きすぎます。撮り直すか手入力を | 手入力/再撮影 |
| `limit` | 本日のAI読み取り上限に達しました（明日0時リセット） | 手入力/OCR |
| `refusal` | 自動読み取りできませんでした。手入力かOCRを | 手入力/OCR |
| `upstream` | AIが混み合っています。少し待つか手入力を | 手入力/OCR |
| `parse` | 読み取り結果を取得できませんでした。手入力を | 手入力/OCR |
| ネット不通/タイムアウト | つながりません。手入力かOCRをお使いください | 手入力/OCR |

**安全弁**：AIが入れた値も**人が確認してから保存**（推測/要確認タグ）。誤読は保存前に直せる。

## コスト・ガードレール

- Haiku・約0.3円/枚・**ボタン押下時のみ**・800px画像。デモ用の少量なら月数十円規模。
- 1日上限（50/枚）＋画像バイト上限＋合言葉トークンで暴走を構造的に防止。
- 残り回数を設定画面に表示（デモ前の使い切り防止）。

## 画像解像度の方針

- 既存 `resizeImage` は長辺800px・JPEG0.7（保存用）。まず**800pxのまま**AIに送って実機で氏名・電話の取りこぼし率を測る。
- 不足する場合は **AI送信用だけ長辺1000〜1200pxの別エンコード**にする選択肢を残す（保存用は800pxのまま）。精度↔コストのトレードオフ。→ **要確認（実測）**。

## テスト方針

- **Task 0：CORS疎通PoC（最初に独立実施）**。固定文字列を返すだけの最小GASをデプロイし、`cmkurashikibranch.github.io` から `fetch` して、DevToolsで「OPTIONS（プリフライト）が出ない／302追従後に200本文が取れる」を確認。**ここが通らなければ設計を見直す**。
- **GAS `testProxy()`**：エディタから手動実行。固定テスト名刺base64を投げ `{ok,data}` を `Logger.log`。secret照合・スキーマ・接頭辞剥がし・`stop_reason`分岐をまとめて確認。`output_config.format` が `claude-haiku-4-5` で効くか（本文JSON・初回コンパイル遅延）も実測。
- **クライアント fetch スタブ（4ケース）**：`{ok:true,data}` / `{ok:false,error:'limit'}` / 不正JSON / タイムアウト。反映関数とエラーUI誘導を検証（ステップ2で確立した「実ファイルから関数抽出→Nodeでスタブ実行」を流用）。
- **実機E2E**：撮影→🤖→スピナー→各欄反映（フラッシュ）→推測/要確認タグ→保存→詳細表示。＋機内モードでボタンを押し、優しいエラー＋手入力誘導。＋QR/hashで別端末に設定が入るか。
- **リグレッション**：`node --test tests/parse-card.test.js`（ステップ2の24ケース）が壊れていないこと。AI経路は `parseCard` を通らない別ルートなので、共通反映関数の引数形だけ揃えれば既存資産を再利用できる。

## 実装の段取り（リスクの高い順）

```
Task 0  CORS疎通PoC（最小GAS→Pagesからfetch成功を確認）← 最初。通らなければ設計見直し
Task 1  GAS本体 gas/Code.gs（doPost：action分岐 / secret照合 / 画像バイト上限 /
        LockService付き日次カウンタ / 接頭辞剥がし / Claude中継 / stop_reason・エラー正規化 /
        ping）→ testProxy() で単体確認
Task 2  クライアント：設定画面 #view-settings（aiEndpoint/aiSecret/残り回数/ping/QR表示）
        ＋ hash受け取り(#cfg=) ＋ DEFAULT_DATA.settings 更新 ＋ 極小QRライブラリ同梱
Task 3  登録画面：🤖AIボタン（写真がある時のみ）/ スピナー＋20秒タイムアウト＋完了フラッシュ /
        aiBusy・offline・no-photo ガード / OCRを<details>へ格下げ
Task 4  反映の共通化 applyParsed(result, source)（runParse を合流）＋ source別マーカー（AIは電話/メールも要確認）
        ＋ 初回プライバシー同意 ＋ 共通ステータス領域
Task 5  fetchスタブ4ケース ＋ 実機E2E（オンライン/オフライン/QR）
Task 6  index.html へコピー ＋ セットアップ手順書（docs/）＋ git push
```

## ステップ3 完了の定義

- Task 0 でGitHub Pages→GASのCORS疎通が確認できている。
- 写真→🤖→反映→確認→保存が動作。読み取り中表示・20秒タイムアウト・完了フラッシュ・各エラーの優しい誘導が機能。
- AI結果は name/company に「推測」、phone/email に「要確認」タグが付き、人が確認して保存できる。
- URLは公開コードに出ず、QR/hashで設定が入る。合言葉トークン照合・1日上限・画像バイト上限が効く。APIキーはGASのScript Propertiesのみ。
- ステップ1・2の既存機能にデグレなし（テスト24/24維持）。データ構造・保存ロジックは不変。単一HTML・外部依存なし（QRライブラリは同梱）・未使用時オフライン動作を維持。

## 要確認事項（実機・ドキュメントで確かめる）

1. **【最重要】GitHub Pages → GAS の CORS が実機で通るか**（`text/plain`単純リクエスト＋302追従）。Task 0 で最初に確認。
2. `output_config.format` が `claude-haiku-4-5` で期待どおり効くか（`stop_reason`・本文JSON・初回コンパイル遅延の実測）。
3. GAS「Anyone」公開時の挙動（再デプロイでURLが変わる/アクセス権が戻る罠）。手順書化する。
4. 800px画像での読取精度の損益分岐（不足なら送信用解像度を上げる）。

## レビュー反映サマリ（2エージェント）

- **UI/UX**：入力経路を主従に（AI主役・OCRは`<details>`）／QR・hashで初期設定ゼロ化／読み取り中の文言＋タイムアウト＋完了フラッシュ／AI結果は電話・メールも要確認／設定保存時の疎通ping／初回プライバシー同意／絵文字🤖で撮影と区別／オフライン時ボタン無効化。
- **エンジニア**：Task 0でCORS疎通を先に検証／GASは固定形`{ok,...}`で返す／`max_tokens=1024`・フラットJSONスキーマ／合言葉トークンはbodyに（ヘッダ不可）／画像バイト上限で巨大画像攻撃を防ぐ／日次カウンタは`LockService`／base64接頭辞剥がしはGAS側／`stop_reason`・不正JSON防御／`DEFAULT_DATA.settings`に既定値追加。
