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
