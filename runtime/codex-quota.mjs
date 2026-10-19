import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { quotaWindows } from './insights-worker.mjs';
import { VERSION } from './paths.mjs';

export class CodexQuotaError extends Error {}

export function findCodexCli(env = process.env, platform = process.platform) {
  if (env.CODEX_CLI) return env.CODEX_CLI;
  if (platform === 'win32' && env.LOCALAPPDATA) {
    const directory = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    if (fs.existsSync(directory)) {
      const candidates = fs.readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(directory, entry.name, 'codex.exe'))
        .filter(file => fs.existsSync(file))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (candidates.length) return candidates[0];
    }
  }
  return platform === 'win32' ? 'codex.exe' : 'codex';
}

export function normalizeCodexQuota(result, now = Date.now()) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new CodexQuotaError('Codex 返回的额度数据无效');
  const limits = result.rateLimitsByLimitId?.codex ?? result.rateLimits;
  const windows = quotaWindows(limits, now, now);
  const count = result.rateLimitResetCredits?.availableCount;
  return {
    available: windows.length > 0, windows, observedAt: now,
    resetCreditsAvailable: Number.isSafeInteger(count) && count >= 0 ? count : null,
    reason: windows.length ? '来自 Codex 官方账户额度接口' : '当前账户未返回可显示的 Codex 额度窗口',
    source: 'codex-app-server',
  };
}

export function readCodexQuota({ codexHome, signal, timeoutMs = 12000, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new CodexQuotaError('额度读取已停止')); return; }
    const child = spawnImpl(findCodexCli(), ['app-server'], {
      stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
      env: { ...process.env, CODEX_HOME: codexHome },
    });
    const lines = readline.createInterface({ input: child.stdout });
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      lines.close(); child.kill();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new CodexQuotaError('额度读取已停止'));
    const timer = setTimeout(() => finish(new CodexQuotaError('读取 Codex 额度超时，请稍后刷新')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    const send = message => child.stdin.write(JSON.stringify(message) + '\n');
    child.once('error', () => finish(new CodexQuotaError('无法启动 Codex，请检查桌面端或 CLI 是否已安装')));
    child.once('close', () => finish(new CodexQuotaError('Codex 额度读取进程已退出，请刷新重试')));
    child.stdin.on('error', () => finish(new CodexQuotaError('与 Codex 的额度读取连接已关闭')));
    lines.on('line', line => {
      if (done) return;
      let message;
      try { message = JSON.parse(line); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        finish(new CodexQuotaError('Codex 返回了无法解析的额度数据')); return;
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        finish(new CodexQuotaError('Codex 返回的额度消息无效')); return;
      }
      if (message.id !== 1 && message.id !== 2) return;
      if (message.error) {
        finish(new CodexQuotaError('Codex 暂时无法读取订阅额度，请确认桌面端已登录')); return;
      }
      if (message.id === 1) {
        send({ method: 'initialized', params: {} });
        send({ id: 2, method: 'account/rateLimits/read' });
      } else {
        try { finish(null, normalizeCodexQuota(message.result)); }
        catch (error) {
          if (!(error instanceof CodexQuotaError)) throw error;
          finish(error);
        }
      }
    });
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'codex_dragon_maiden', title: 'Codex Dragon Maiden', version: VERSION },
    } });
  });
}

export function createCodexQuotaService({ codexHome, read = readCodexQuota } = {}) {
  let cached = null, pending = null, closed = false;
  const controller = new AbortController();
  return {
    async get({ force = false } = {}) {
      if (closed) return { available: false, windows: [], reason: '额度读取已停止' };
      if (!pending && (force || !cached || Date.now() - cached.observedAt >= 30000)) {
        pending = read({ codexHome, signal: controller.signal }).catch(error => {
          if (!(error instanceof CodexQuotaError)) throw error;
          return { available: false, windows: [], observedAt: Date.now(), resetCreditsAvailable: null, reason: error.message };
        }).then(result => { cached = result; return result; }).finally(() => { pending = null; });
      }
      return pending || cached;
    },
    close() { closed = true; cached = null; controller.abort(); },
  };
}
