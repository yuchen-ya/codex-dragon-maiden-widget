import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { ROOT } from '../runtime/paths.mjs';
import { DEFAULT_JEV_SETTINGS, JEV_PRESETS, JevSettingsStore, validateJevSettings } from '../runtime/jev-settings.mjs';
import { JevConnection } from '../runtime/jev-connection.mjs';
import { createDispatcher } from '../runtime/dispatcher.mjs';

const success = { answers: { connection_test: { type: 'noul', noul: 0.99 } } };
function directory(t) {
  const parent = path.resolve(ROOT, 'qa-output'); fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'jev-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.ok(path.basename(root).startsWith('jev-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  return 'http://127.0.0.1:' + instance.address().port;
}
const respond = (res, value = success, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
const draft = endpoint => ({ provider: 'custom', endpoint, model: 'custom-jev-model', keyEnv: 'TEST_JEV_KEY', network: { mode: 'direct', proxyUrl: '' } });
function connection(t, extra = {}) {
  const client = new JevConnection({ dataDir: directory(t), env: { TEST_JEV_KEY: 'FAKE_JEV_SECRET' }, ...extra });
  t.after(() => client.close());
  return client;
}

test('Jev settings default to direct, store only key references and restore custom connections', t => {
  const dataDir = directory(t), env = { TEST_JEV_KEY: 'FAKE_JEV_SECRET' };
  const store = new JevSettingsStore({ dataDir, env });
  assert.deepEqual(store.load(), DEFAULT_JEV_SETTINGS);
  assert.equal(store.info().keyConfigured, false);
  const saved = store.save({ ...draft('https://example.test/decision'), network: { mode: 'proxy', proxyUrl: 'http://127.0.0.1:9876' } });
  assert.deepEqual(new JevSettingsStore({ dataDir, env }).load(), saved);
  assert.equal(store.info().keyConfigured, true);
  assert.ok(!fs.readFileSync(store.file, 'utf8').includes(env.TEST_JEV_KEY));
  assert.ok(!JSON.stringify(store.info()).includes(env.TEST_JEV_KEY));
  assert.equal(JEV_PRESETS.typesafe.endpoint, 'https://api.typesafe.ai/v1/systemone');
  assert.throws(() => store.prepare({ provider: 'typesafe' }), /同时确认/);
});

test('Jev settings reject secrets, insecure remote URLs and unsupported proxies at the boundary', () => {
  for (const patch of [
    { apiKey: 'SECRET' }, { provider: '__proto__' }, { provider: ['openrouter'] }, { endpoint: 'http://example.test/decision' },
    { endpoint: 'https://user:secret@example.test/' }, { endpoint: 'https://example.test/?key=SECRET' },
    { model: '' }, { keyEnv: 'not an environment name' },
    { network: { mode: 'auto', proxyUrl: '' } }, { network: { mode: 'proxy', proxyUrl: '' } },
    { network: { mode: 'proxy', proxyUrl: 'socks5://localhost:1234' } },
    { network: { mode: 'proxy', proxyUrl: 'http://user:secret@localhost:1234' } },
    { network: { mode: 'proxy', proxyUrl: 'http://localhost:1234/path' } },
  ]) assert.throws(() => validateJevSettings({ ...DEFAULT_JEV_SETTINGS, ...patch }));
  assert.equal(validateJevSettings({ ...DEFAULT_JEV_SETTINGS, network: { mode: 'proxy', proxyUrl: 'https://proxy.example:8443/' } }).network.proxyUrl, 'https://proxy.example:8443');
});

test('direct test uses selected model and key, sends a fixed probe and does not save the draft', async t => {
  const calls = [];
  const endpoint = await server(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push({ url: req.url, key: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) });
    respond(res);
  });
  const client = connection(t);
  const result = await client.test(draft(endpoint + '/my-decision'));
  assert.equal(result.networkMode, 'direct'); assert.equal(result.model, 'custom-jev-model');
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/my-decision');
  assert.equal(calls[0].key, 'Bearer FAKE_JEV_SECRET');
  assert.deepEqual(calls[0].body.state, { message: 'This is a connection test.' });
  assert.equal(calls[0].body.model, 'custom-jev-model');
  assert.deepEqual(client.info().settings, DEFAULT_JEV_SETTINGS);
  assert.ok(!fs.existsSync(client.store.file));
  assert.ok(!JSON.stringify(result).includes('FAKE_JEV_SECRET'));
});

test('explicit proxy routes through the chosen port despite NO_PROXY, while direct ignores proxy environment', async t => {
  let proxyCalls = 0, directCalls = 0;
  const proxy = await server(t, (req, res) => { proxyCalls++; assert.ok(req.url.startsWith('http://')); respond(res); });
  const endpoint = await server(t, (_req, res) => { directCalls++; respond(res); });
  const saved = Object.fromEntries(['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, NO_PROXY: '*' });
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const client = connection(t);
  await client.test({ ...draft(endpoint + '/decision'), network: { mode: 'proxy', proxyUrl: proxy } });
  assert.equal(proxyCalls, 1); assert.equal(directCalls, 0);
  await client.test(draft(endpoint + '/decision'));
  assert.equal(proxyCalls, 1); assert.equal(directCalls, 1);
});

test('failed proxy never retries against a reachable direct endpoint', async t => {
  let directCalls = 0;
  const endpoint = await server(t, (_req, res) => { directCalls++; respond(res); });
  const unavailable = http.createServer(); await new Promise(resolve => unavailable.listen(0, '127.0.0.1', resolve));
  const port = unavailable.address().port; await new Promise(resolve => unavailable.close(resolve));
  await assert.rejects(connection(t).test({ ...draft(endpoint), network: { mode: 'proxy', proxyUrl: 'http://127.0.0.1:' + port } }), error => error.code === 'NETWORK' && /未改用直连/.test(error.message));
  assert.equal(directCalls, 0);
});

test('redirects are not followed and upstream error bodies never reach callers', async t => {
  let destinationCalls = 0;
  const destination = await server(t, (_req, res) => { destinationCalls++; respond(res); });
  const redirect = await server(t, (_req, res) => { res.writeHead(302, { Location: destination }); res.end('PRIVATE_UPSTREAM_BODY'); });
  const client = connection(t);
  await assert.rejects(client.test(draft(redirect)), error => error.code === 'HTTP_302' && !error.message.includes('PRIVATE_UPSTREAM_BODY'));
  assert.equal(destinationCalls, 0);
  const denied = await server(t, (_req, res) => respond(res, { message: 'FAKE_JEV_SECRET' }, 401));
  await assert.rejects(client.test(draft(denied)), error => error.code === 'HTTP_401' && !error.message.includes('FAKE_JEV_SECRET'));
});

test('invalid decision responses and missing credentials are explicit failures', async t => {
  const endpoint = await server(t, (_req, res) => respond(res, { answers: { connection_test: { type: 'noul', noul: 1.1 } } }));
  await assert.rejects(connection(t).test(draft(endpoint)), error => error.code === 'RESPONSE');
  await assert.rejects(connection(t, { env: {} }).test(draft(endpoint)), error => error.code === 'NO_KEY');
});

test('cancel, configuration changes and shutdown abort in-flight tests without late success', async t => {
  const began = []; let notify;
  const endpoint = await server(t, (_req, _res) => { began.push(true); notify(); });
  const client = connection(t);
  for (const action of [() => client.cancel(), () => client.save({ model: 'another-model' }), () => client.close()]) {
    const started = new Promise(resolve => { notify = resolve; });
    const tested = client.test(draft(endpoint));
    const rejected = assert.rejects(tested, error => error.code === 'ABORTED');
    await started; action(); await rejected;
  }
  assert.equal(began.length, 3);
  await assert.rejects(client.test(draft(endpoint)), error => error.code === 'CLOSED');
});

test('test timeout bounds the entire connection wait', async t => {
  const endpoint = await server(t, () => {});
  await assert.rejects(connection(t, { timeoutMs: 60 }).test(draft(endpoint)), error => error.code === 'ABORTED');
});

test('late cancellation from an old dialog cannot cancel a newer connection test', async t => {
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  const endpoint = await server(t, (_req, res) => { release = () => respond(res); began(); });
  const client = connection(t);
  const pending = client.test(draft(endpoint), 'new-dialog');
  await started;
  client.cancel('old-dialog'); release();
  assert.equal((await pending).ok, true);
});

test('dispatcher exposes editable settings, guarded test and cancellation with no automatic calls', async t => {
  const dataDir = directory(t), client = new JevConnection({ dataDir, env: { TEST_JEV_KEY: 'FAKE_JEV_SECRET' } });
  const api = createDispatcher({ dataDir, monitor: false, autoRefresh: false, jevConnection: client });
  t.after(() => api.close());
  const request = async (route, method = 'GET', body) => {
    const response = await api.dispatch(route, { method, body });
    return { status: response.status, payload: JSON.parse(response.body) };
  };
  let calls = 0;
  const endpoint = await server(t, (_req, res) => { calls++; respond(res); });
  assert.equal((await request('/api/jev-settings')).payload.settings.network.mode, 'direct');
  assert.equal((await request('/api/jev-test', 'GET')).status, 405);
  assert.equal((await request('/api/jev-settings', 'PUT', draft(endpoint))).status, 200);
  assert.equal(calls, 0);
  assert.equal((await request('/api/jev-test', 'POST', {})).payload.ok, true);
  assert.equal(calls, 1);
  assert.equal((await request('/api/jev-test/cancel', 'POST')).payload.ok, true);
  assert.equal((await request('/api/jev-settings', 'PUT', { apiKey: 'FAKE_JEV_SECRET' })).status, 400);
  assert.equal((await api.dispatch('/jev-settings.js')).status, 200);
  const html = (await api.dispatch('/widget.html')).body.toString();
  assert.ok(html.includes('/jev-settings.js'));
});
