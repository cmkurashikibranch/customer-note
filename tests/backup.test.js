const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function loadBackup() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'customer-note.html'), 'utf8');
  const m = html.match(/\/\* BACKUP:START \*\/([\s\S]*?)\/\* BACKUP:END \*\//);
  if (!m) throw new Error('BACKUP block not found in customer-note.html');
  const mod = { exports: {} };
  new Function('module', 'exports', m[1])(mod, mod.exports);
  return mod.exports;
}
const { buildBackupEnvelope, backupFilename, validateBackup, normalizeBackup } = loadBackup();

const DEFAULTS = { followUpDays: 14, aiEndpoint: '', aiSecret: '', aiConsent: false, lastBackup: '', reminderSnoozedOn: '' };
const CURRENT  = { followUpDays: 14, aiEndpoint: 'https://gas/exec', aiSecret: 'himitsu', aiConsent: true, lastBackup: '2026-07-01', reminderSnoozedOn: '2026-07-05' };

function sampleAppData() {
  return {
    customers: [{ id: 3, name: '山田 太郎', company: '山田工務店', phone: '', email: '', photo: null, lastContact: '2026-07-01', history: [{ date: '2026-07-01', note: '登録' }] }],
    settings: Object.assign({}, CURRENT),
    nextId: 4
  };
}

// --- buildBackupEnvelope ---
test('封筒形式：app/version/exportedAt/data が揃う', () => {
  const env = buildBackupEnvelope(sampleAppData(), '2026-07-08');
  assert.strictEqual(env.app, 'customer-note');
  assert.strictEqual(env.version, 1);
  assert.strictEqual(env.exportedAt, '2026-07-08');
  assert.strictEqual(env.data.customers.length, 1);
  assert.strictEqual(env.data.nextId, 4);
  assert.strictEqual(env.data.settings.followUpDays, 14);
});
test('封筒にAI設定とlastBackupが含まれない', () => {
  const env = buildBackupEnvelope(sampleAppData(), '2026-07-08');
  const json = JSON.stringify(env);
  assert.ok(!json.includes('himitsu'));
  assert.ok(!json.includes('aiEndpoint'));
  assert.ok(!json.includes('aiSecret'));
  assert.ok(!json.includes('aiConsent'));
  assert.ok(!json.includes('lastBackup'));
});

// --- backupFilename ---
test('ファイル名に日付が入る', () => {
  assert.strictEqual(backupFilename('2026-07-08'), 'お客様ノート_バックアップ_2026-07-08.json');
});

// --- validateBackup ---
test('正常な封筒はそのまま返る（往復）', () => {
  const env = buildBackupEnvelope(sampleAppData(), '2026-07-08');
  const v = validateBackup(JSON.stringify(env));
  assert.deepStrictEqual(v, env);
});
test('壊れたJSONは null（例外を投げない）', () => {
  assert.strictEqual(validateBackup('{oops'), null);
  assert.strictEqual(validateBackup(''), null);
  assert.strictEqual(validateBackup(null), null);
});
test('appが違うファイルは null', () => {
  assert.strictEqual(validateBackup(JSON.stringify({ app: 'other', version: 1, data: { customers: [] } })), null);
});
test('customersが配列でなければ null', () => {
  assert.strictEqual(validateBackup(JSON.stringify({ app: 'customer-note', version: 1, data: { customers: 'x' } })), null);
});
test('id/nameが欠けたcustomerがいたら null', () => {
  assert.strictEqual(validateBackup(JSON.stringify({ app: 'customer-note', version: 1, data: { customers: [{ id: 1 }] } })), null);
  assert.strictEqual(validateBackup(JSON.stringify({ app: 'customer-note', version: 1, data: { customers: [{ name: 'x' }] } })), null);
});
test('version>1 は tooNew', () => {
  const v = validateBackup(JSON.stringify({ app: 'customer-note', version: 2, data: { customers: [] } }));
  assert.deepStrictEqual(v, { tooNew: true });
});

// --- normalizeBackup ---
test('lastContact欠落はexportedAtで補完・history非配列は[]', () => {
  const env = { app: 'customer-note', version: 1, exportedAt: '2026-06-20', data: { customers: [{ id: 1, name: 'A' }], nextId: 2, settings: { followUpDays: 7 } } };
  const out = normalizeBackup(env, CURRENT, DEFAULTS, '2026-07-08');
  assert.strictEqual(out.customers[0].lastContact, '2026-06-20');
  assert.deepStrictEqual(out.customers[0].history, []);
});
test('exportedAtも無ければ今日で補完', () => {
  const env = { app: 'customer-note', version: 1, data: { customers: [{ id: 1, name: 'A' }], nextId: 2 } };
  const out = normalizeBackup(env, CURRENT, DEFAULTS, '2026-07-08');
  assert.strictEqual(out.customers[0].lastContact, '2026-07-08');
});
test('AI設定・lastBackup・スヌーズは現端末値を維持し、followUpDaysはファイル値', () => {
  const env = { app: 'customer-note', version: 1, exportedAt: '2026-06-20', data: { customers: [], nextId: 1, settings: { followUpDays: 30 } } };
  const out = normalizeBackup(env, CURRENT, DEFAULTS, '2026-07-08');
  assert.strictEqual(out.settings.aiEndpoint, 'https://gas/exec');
  assert.strictEqual(out.settings.aiSecret, 'himitsu');
  assert.strictEqual(out.settings.aiConsent, true);
  assert.strictEqual(out.settings.lastBackup, '2026-07-01');
  assert.strictEqual(out.settings.reminderSnoozedOn, '2026-07-05');
  assert.strictEqual(out.settings.followUpDays, 30);
});
test('followUpDaysが不正なら現端末値のまま', () => {
  const env = { app: 'customer-note', version: 1, data: { customers: [], nextId: 1, settings: { followUpDays: 'x' } } };
  const out = normalizeBackup(env, CURRENT, DEFAULTS, '2026-07-08');
  assert.strictEqual(out.settings.followUpDays, 14);
});
test('nextIdはmax(id)+1未満なら補正・空配列でも安全', () => {
  const env1 = { app: 'customer-note', version: 1, exportedAt: '2026-06-20', data: { customers: [{ id: 9, name: 'A', lastContact: '2026-06-01', history: [] }], nextId: 2 } };
  assert.strictEqual(normalizeBackup(env1, CURRENT, DEFAULTS, '2026-07-08').nextId, 10);
  const env2 = { app: 'customer-note', version: 1, data: { customers: [] } };
  assert.strictEqual(normalizeBackup(env2, CURRENT, DEFAULTS, '2026-07-08').nextId, 1);
});
