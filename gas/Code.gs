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
