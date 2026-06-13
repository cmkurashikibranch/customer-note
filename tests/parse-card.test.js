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
