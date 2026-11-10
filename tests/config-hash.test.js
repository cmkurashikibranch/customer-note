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
const { b64urlEncode, parseConfigHash, isAllowedEndpoint } = loadCfg();

test('encode→parse で往復できる', () => {
  const link = '#cfg=' + b64urlEncode(JSON.stringify({ u: 'https://script.google.com/macros/s/AKfycbTEST_dummy-123/exec', s: 'secret123' }));
  assert.deepStrictEqual(parseConfigHash(link), { endpoint: 'https://script.google.com/macros/s/AKfycbTEST_dummy-123/exec', secret: 'secret123' });
});
test('日本語を含む合言葉でも往復できる', () => {
  const link = '#cfg=' + b64urlEncode(JSON.stringify({ u: 'https://script.google.com/macros/s/AKfycbTEST_dummy-123/exec', s: 'あいことば' }));
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
  const link = '#cfg=' + b64urlEncode(JSON.stringify({ u: 'https://script.google.com/macros/s/AKfycbTEST_dummy-123/exec' }));
  assert.strictEqual(parseConfigHash(link), null);
});

// 2026-11-10 セキュリティ点検：設定リンクの送り先は自分のGAS（script.google.com の /exec）だけ受け付ける
test('送り先がGASの/exec以外のリンクは null', () => {
  const bad = [
    'https://evil.example.com/exec',
    'http://script.google.com/macros/s/AKfycbTEST/exec',
    'https://script.google.com.evil.example.com/macros/s/AKfycbTEST/exec',
    'https://evil.example.com/?https://script.google.com/macros/s/AKfycbTEST/exec',
    'https://script.google.com/macros/s/AKfycbTEST/exec?x=1',
    'https://script.google.com/macros/s/AKfycbTEST/dev',
    'javascript:alert(1)',
    ''
  ];
  bad.forEach((u) => {
    const link = '#cfg=' + b64urlEncode(JSON.stringify({ u: u, s: 'secret123' }));
    assert.strictEqual(parseConfigHash(link), null, u);
    assert.strictEqual(isAllowedEndpoint(u), false, u);
  });
});
test('GASの/exec（Workspaceの /a/macros/ 形も）は通る', () => {
  assert.strictEqual(isAllowedEndpoint('https://script.google.com/macros/s/AKfycb_Te-st123/exec'), true);
  assert.strictEqual(isAllowedEndpoint('https://script.google.com/a/macros/example.co.jp/s/AKfycb_Te-st123/exec'), true);
  assert.strictEqual(isAllowedEndpoint(null), false);
});
