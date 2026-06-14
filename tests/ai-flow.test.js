const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'customer-note.html'), 'utf8');

// applyParsed と aiErrorMessage を実ファイルから抽出して、DOMスタブ上で実行する
function extract(fnName) {
  const re = new RegExp('function ' + fnName + '\\s*\\([\\s\\S]*?\\n}\\n');
  const m = html.match(re);
  if (!m) throw new Error(fnName + ' not found');
  return m[0];
}

function makeEnv() {
  const fields = {};
  ['reg-name','reg-company','reg-phone','reg-email','reg-note','reg-paste-status']
    .forEach(id => { fields[id] = { value: '', textContent: '', style: {}, classList: { add(){}, remove(){} } }; });
  const document = {
    getElementById: id => fields[id] || { value: '', textContent: '', style: {}, classList: { add(){}, remove(){} } }
  };
  function setGuess() {}
  const env = { document, setGuess };
  const code = extract('applyParsed') + '\n' + extract('aiErrorMessage');
  new Function('document', 'setGuess', code + '\nthis.applyParsed = applyParsed; this.aiErrorMessage = aiErrorMessage;').call(env, document, setGuess);
  return { env, fields };
}

test('applyParsed(ai): 全項目を反映しmemoは追記', () => {
  const { env, fields } = makeEnv();
  fields['reg-note'].value = '守成クラブで交換';
  env.applyParsed({ name:'山田太郎', company:'山田工務店', phone:'086-426-1111', email:'a@b.jp', memo:'役職：代表' }, 'ai');
  assert.strictEqual(fields['reg-name'].value, '山田太郎');
  assert.strictEqual(fields['reg-phone'].value, '086-426-1111');
  assert.ok(fields['reg-note'].value.includes('守成クラブで交換'));
  assert.ok(fields['reg-note'].value.includes('役職：代表'));
  assert.ok(fields['reg-paste-status'].textContent.includes('AIが読み取りました'));
});

test('applyParsed: 空項目は既存の手入力を消さない', () => {
  const { env, fields } = makeEnv();
  fields['reg-name'].value = '既存名';
  env.applyParsed({ name:'', company:'X社', phone:'', email:'', memo:'' }, 'ai');
  assert.strictEqual(fields['reg-name'].value, '既存名');
  assert.strictEqual(fields['reg-company'].value, 'X社');
});

test('aiErrorMessage: 各コードに日本語', () => {
  const { env } = makeEnv();
  assert.ok(env.aiErrorMessage('limit').includes('上限'));
  assert.ok(env.aiErrorMessage('auth').includes('合言葉'));
  assert.ok(env.aiErrorMessage('bad_image').includes('大き'));
  assert.ok(env.aiErrorMessage(undefined).length > 0);
});
