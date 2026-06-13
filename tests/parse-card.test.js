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
