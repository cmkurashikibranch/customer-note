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

test('株式会社を含む行を company に', () => {
  assert.strictEqual(parseCard('株式会社山田工務店').company, '株式会社山田工務店');
});

test('屋号（〇〇屋・行末・3字以上）を company に', () => {
  assert.strictEqual(parseCard('山田屋').company, '山田屋');
});

test('役職＋名前が同一行：名前を分割し役職はメモへ', () => {
  const r = parseCard('代表取締役 山田太郎');
  assert.strictEqual(r.name, '山田太郎');
  assert.ok(r.memo.startsWith('役職：代表取締役'));
});

test('「営業部 部長」は部署を名前にせず役職のみ', () => {
  const r = parseCard('営業部 部長');
  assert.strictEqual(r.name, '');
  assert.ok(r.memo.includes('役職：部長'));
});

test('店長(役職)は会社に誤判定しない', () => {
  const r = parseCard('店長');
  assert.strictEqual(r.company, '');
  assert.ok(r.memo.includes('役職：店長'));
});

test('漢字フルネーム（姓 名）を name に', () => {
  assert.strictEqual(parseCard('山田 太郎').name, '山田 太郎');
});

test('ふりがな行より漢字名を優先', () => {
  const r = parseCard('やまだ たろう\n山田 太郎');
  assert.strictEqual(r.name, '山田 太郎');
});

test('標準的な名刺：全項目を埋める', () => {
  const card = [
    '株式会社 山田工務店',
    '代表取締役 山田太郎',
    '〒700-0000 岡山県倉敷市青葉町1-2-3',
    'TEL 086-426-1111  FAX 086-426-2222',
    'yamada@example.co.jp'
  ].join('\n');
  const r = parseCard(card);
  assert.strictEqual(r.company, '株式会社 山田工務店');
  assert.strictEqual(r.name, '山田太郎');
  assert.strictEqual(r.phone, '086-426-1111');
  assert.strictEqual(r.email, 'yamada@example.co.jp');
  assert.ok(r.memo.includes('役職：代表取締役'));
  assert.ok(r.memo.includes('倉敷市'));
  assert.ok(r.memo.includes('086-426-2222'));
});

test('一致ゼロ（記号の羅列）は全項目空・例外なし', () => {
  const r = parseCard('### ^^^ ~~~');
  assert.strictEqual(r.name, '');
  assert.strictEqual(r.company, '');
  assert.strictEqual(r.phone, '');
  assert.strictEqual(r.email, '');
});

test('英語のみ名刺：email/company は拾い、落ちない', () => {
  const r = parseCard('Yamada Design Inc.\ninfo@yamada.com');
  assert.strictEqual(r.email, 'info@yamada.com');
  assert.ok(r.company.includes('Inc.'));
});
