import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importWorkshop, exportWorkshop, validateWorkshop, WORKSHOP_MAX_BYTES } from '../lib/workshop.mjs';

function root(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-workshop-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const image = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
function wav() {
  const b = Buffer.alloc(48); b.write('RIFF'); b.writeUInt32LE(40, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(4, 40);
  return b.toString('base64');
}
function pack() { return { schema: 'api-balance-whale-workshop', version: 1,
  roles: [{ id: 'r1', name: '角色', format: 'gif', data: image }],
  images: [{ id: 'i1', name: '气泡', format: 'gif', data: image }],
  fragments: [{ id: 'f1', name: '音频', format: 'wav', data: wav() }],
  groups: [{ id: 'g1', name: '音效组', press: 'f1', release: 'ya2' }] }; }
test('portable roundtrip remaps references and never overwrites repeated imports', t => {
  const dir = root(t), input = pack();
  const first = importWorkshop(dir, input), second = importWorkshop(dir, input);
  assert.notEqual(first.idMap.roles.r1, second.idMap.roles.r1);
  const output = exportWorkshop(dir);
  assert.equal(output.roles.length, 2); assert.equal(output.groups.length, 2);
  assert.equal(output.groups[0].press, first.idMap.fragments.f1);
  assert.equal(output.groups[0].release, 'ya2');
  assert.ok(!JSON.stringify(output).includes(dir));
  assert.deepEqual(first.counts, { roles: 1, images: 1, fragments: 1, groups: 1 });
});
test('rejects traversal, extra credential/settings fields, invalid media, missing references before writes', t => {
  const dir = root(t);
  const bad = [p => { p.roles[0].id = '../escape'; }, p => { p.apiKey = 'secret'; }, p => { p.roles[0].path = 'C:/private'; }, p => { p.roles[0].data = Buffer.from('<script>x</script>').toString('base64'); }, p => { p.groups[0].press = 'missing'; }, p => { p.roles.push(p.roles[0]); }, p => { p.roles[0].format = 'png'; }];
  for (const mutate of bad) { const p = pack(); mutate(p); assert.throws(() => importWorkshop(dir, p)); assert.deepEqual(fs.readdirSync(dir), []); }
});
test('second index write failure restores previous indexes and removes staged media', t => {
  const dir = root(t); importWorkshop(dir, pack());
  const snapshot = () => Object.fromEntries(fs.readdirSync(dir).flatMap(folder => fs.readdirSync(path.join(dir, folder)).map(file => [folder + '/' + file, fs.readFileSync(path.join(dir, folder, file)).toString('base64')])));
  const before = snapshot();
  assert.throws(() => importWorkshop(dir, pack(), { beforeIndexWrite(kind) { if (kind === 'audio') throw new Error('simulated disk failure'); } }), /simulated disk failure/);
  assert.deepEqual(snapshot(), before);
});
test('failed first import does not leave committed library entries', t => {
  const dir = root(t);
  assert.throws(() => importWorkshop(dir, pack(), { beforeIndexWrite(kind) { if (kind === 'audio') throw new Error('fault'); } }));
  assert.deepEqual(exportWorkshop(dir), { schema: 'api-balance-whale-workshop', version: 1, roles: [], images: [], fragments: [], groups: [] });
});
test('corrupt existing index is preserved rather than silently replaced', t => {
  const dir = root(t); fs.mkdirSync(path.join(dir, 'whale-audio')); const file = path.join(dir, 'whale-audio', 'audio.json'); fs.writeFileSync(file, '{broken');
  assert.throws(() => importWorkshop(dir, pack()), /已损坏/); assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
test('export excludes settings, ledger, pinned state and arbitrary index metadata', t => {
  const dir = root(t); const imported = importWorkshop(dir, pack());
  fs.writeFileSync(path.join(dir, '.dshw-usage.json'), '{"secret":"private ledger"}');
  const file = path.join(dir, 'whale-roles', 'roles.json'); const index = JSON.parse(fs.readFileSync(file));
  const role = index.roles.find(role => role.id === imported.idMap.roles.r1);
  role.privatePath = 'C:/secret'; role.pinnedAt = 123; fs.writeFileSync(file, JSON.stringify(index));
  assert.ok(!JSON.stringify(exportWorkshop(dir)).includes('secret'));
  assert.deepEqual(Object.keys(exportWorkshop(dir).roles[0]).sort(), ['data', 'format', 'id', 'name']);
});
test('strict base64 and request budget reject before decoding', () => {
  const p = pack(); p.fragments[0].data = '!!!!'; assert.throws(() => validateWorkshop(p));
  assert.throws(() => validateWorkshop(' '.repeat(WORKSHOP_MAX_BYTES + 1)), /24 MiB/);
});
