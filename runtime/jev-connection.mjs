import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { readEnvironment } from './config-connections.mjs';
import { JevSettingsStore } from './jev-settings.mjs';

export class JevConnectionError extends Error {
  constructor(code, message) { super(message); this.name = 'JevConnectionError'; this.code = code; }
}

function networkError(error, signal, mode) {
  if (error instanceof JevConnectionError) return error;
  if (signal.aborted) return new JevConnectionError('ABORTED', 'Jev 连接测试已取消或超时');
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(error.code)) {
    return new JevConnectionError('TLS', 'Jev 连接证书校验失败，请检查系统证书与代理');
  }
  return new JevConnectionError('NETWORK', mode === 'proxy'
    ? '无法通过指定代理连接 Jev，请检查代理地址和服务状态；未改用直连'
    : '无法直连 Jev，请检查网络，或在设置中选择代理');
}

// A private Agent isolates this connection from global/environment proxy rules.
// Explicit proxy mode intentionally supplies no NO_PROXY bypass or direct retry.
function connectionAgent(protocol, network) {
  if (network.mode === 'proxy') {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 24 || major === 24 && minor < 5) {
      throw new JevConnectionError('RUNTIME', 'Jev 指定代理需要 Node.js 24.5 或更新版本，请更新桌面运行组件');
    }
  }
  const proxyEnv = network.mode === 'proxy'
    ? { HTTP_PROXY: network.proxyUrl, HTTPS_PROXY: network.proxyUrl, NO_PROXY: '' } : {};
  const Agent = protocol === 'https:' ? https.Agent : http.Agent;
  return new Agent({ proxyEnv, keepAlive: false });
}

async function postDecision(settings, key, payload, signal) {
  const url = new URL(settings.endpoint);
  const agent = connectionAgent(url.protocol, settings.network);
  const request = url.protocol === 'https:' ? https.request : http.request;
  const body = Buffer.from(JSON.stringify(payload));
  try {
    return await new Promise((resolve, reject) => {
      const req = request(url, { method: 'POST', agent, signal,
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, Authorization: 'Bearer ' + key } }, res => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new JevConnectionError('HTTP_' + res.statusCode,
            [401, 403].includes(res.statusCode) ? 'Jev 认证失败，请核对服务商与密钥环境变量' :
              res.statusCode === 429 ? 'Jev 服务请求受限，请稍后再测试' :
                res.statusCode >= 300 && res.statusCode < 400 ? 'Jev 接口返回重定向，请填写最终接口地址；未转发密钥' :
                  'Jev 接口请求失败，请核对完整接口地址与模型名称'));
          return;
        }
        const chunks = []; let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 1024 * 1024) { res.destroy(new JevConnectionError('RESPONSE', 'Jev 响应过大')); return; }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          let data;
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch (error) {
            if (!(error instanceof SyntaxError)) { reject(error); return; }
            reject(new JevConnectionError('RESPONSE', 'Jev 接口没有返回有效的决策 JSON')); return;
          }
          resolve(data);
        });
      });
      req.on('error', reject);
      req.end(body);
    });
  } catch (error) {
    throw networkError(error, signal, settings.network.mode);
  } finally {
    agent.destroy();
  }
}

export class JevConnection {
  constructor({ dataDir, env = process.env, timeoutMs = 15000 } = {}) {
    this.store = new JevSettingsStore({ dataDir, env });
    this.timeoutMs = timeoutMs;
    this.active = null;
    this.closed = false;
  }
  info() { return this.store.info(); }
  save(patch) {
    const settings = this.store.save(patch);
    this.cancel();
    return { settings, keyConfigured: !!readEnvironment(this.store.env, settings.keyEnv) };
  }
  cancel(requestId) {
    if (this.active && (requestId === undefined || requestId === this.active.requestId)) this.active.controller.abort();
  }
  close() { this.closed = true; this.cancel(); }
  async decide(state, questions, { signal, timeoutMs = 2000 } = {}) {
    if (this.closed) throw new JevConnectionError('CLOSED', 'Jev 连接已关闭');
    const settings = this.store.load();
    if (!settings.enabled) return null;
    const key = readEnvironment(this.store.env, settings.keyEnv);
    if (!key) throw new JevConnectionError('NO_KEY', '未读取到 Jev 密钥，请设置所选环境变量并重启桌宠');
    const deadline = AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)));
    return postDecision(settings, key, { model: settings.model, state, questions },
      signal ? AbortSignal.any([signal, deadline]) : deadline);
  }
  async test(patch = {}, requestId) {
    if (this.closed) throw new JevConnectionError('CLOSED', 'Jev 连接已关闭');
    if (requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(requestId))) {
      throw new JevConnectionError('REQUEST', '连接测试编号无效');
    }
    const settings = this.store.prepare(patch);
    const key = readEnvironment(this.store.env, settings.keyEnv);
    if (!key) throw new JevConnectionError('NO_KEY', '未读取到 Jev 密钥，请设置所选环境变量并重启桌宠');
    this.cancel();
    const controller = new AbortController();
    this.active = { controller, requestId };
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)]);
    const started = performance.now();
    try {
      // This deliberate probe contains no user conversation or recommendation.
      const result = await postDecision(settings, key, {
        model: settings.model, state: { message: 'This is a connection test.' },
        questions: { connection_test: { type: 'noul', instructions: 'Is the message a connection test?' } },
      }, signal);
      if (signal.aborted) throw new JevConnectionError('ABORTED', 'Jev 连接测试已取消或超时');
      const answer = result?.answers?.connection_test;
      if (answer?.type !== 'noul' || typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
        throw new JevConnectionError('RESPONSE', 'Jev 接口的决策响应格式不兼容');
      }
      return { ok: true, model: settings.model, networkMode: settings.network.mode,
        elapsedMs: Math.round(performance.now() - started) };
    } finally {
      if (this.active?.controller === controller) this.active = null;
    }
  }
}
