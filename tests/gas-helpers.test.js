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
