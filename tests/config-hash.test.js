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
