import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

export const DASHBOARD_VERSION = '1.1.3';
// Official v1.1.3 release assets. Downloads are verified before execution.
const releases = {
  'win32-x64': ['windows-x64.exe', '63c17ac1fabfc103d82fc8b39a0475e12e046918b7b4529563bfcc39fc5fb7f3'],
  'darwin-arm64': ['macos-arm64', '1385571c013e99ef0276450d3235baba0f1482f52dd32bc9f6788c1e99ae3895'],
  'darwin-x64': ['macos-x64', '40c5c81c573c392b2ab7b99066fae4998a2d9ede62d9be6c715c7cde41df3fcc'],
  'linux-x64': ['linux-x64', '722d7f314e9daf1dfaca5135afa3f08ab7f1a7a19c4f616470cf7ace8db57887'],
};
export class DashboardError extends Error {}

export function dashboardExecutable(dataDir) {
  return path.join(dataDir, 'usage-dashboard', DASHBOARD_VERSION, process.platform === 'win32' ? 'codex-usage-dashboard.exe' : 'codex-usage-dashboard');
}

export async function installDashboardRuntime(dataDir, { signal } = {}) {
  const release = releases[process.platform + '-' + process.arch];
  if (!release) throw new DashboardError('统计组件暂不支持当前系统架构');
  const executable = dashboardExecutable(dataDir);
  let bytes;
  try { bytes = await fs.readFile(executable); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (bytes) {
    if (createHash('sha256').update(bytes).digest('hex') !== release[1]) throw new DashboardError('统计组件校验失败，请删除该组件后重新安装');
    return executable;
  }
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.copyFile(new URL('../vendor/codex-usage-dashboard/LICENSE', import.meta.url), path.join(path.dirname(executable), 'LICENSE'));
  const temporary = executable + '.' + randomBytes(6).toString('hex') + '.tmp';
  const url = `https://github.com/luyh7/codex-usage-dashboard/releases/download/v${DASHBOARD_VERSION}/cousash-${DASHBOARD_VERSION}-cli-${release[0]}`;
  const args = ['--fail', '--location', '--silent', '--show-error', '--connect-timeout', '15', '--max-time', '120', '--max-filesize', '40000000', '--proto', '=https', '--proto-redir', '=https', '--output', temporary];
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (proxy) args.push('--proxy', proxy);
  args.push(url);
  try {
    try { await promisify(execFile)('curl', args, { windowsHide: true, signal, timeout: 125000 }); }
    catch { throw new DashboardError('统计组件下载失败，请检查网络或 HTTPS_PROXY 后刷新重试'); }
    const downloaded = await fs.readFile(temporary);
    if (createHash('sha256').update(downloaded).digest('hex') !== release[1]) throw new DashboardError('统计组件下载校验失败，请刷新重试');
    await fs.chmod(temporary, 0o700);
    await fs.rename(temporary, executable);
    return executable;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export function createDashboardRuntime({ dataDir, codexHome }) {
  let child = null, starting = null, address = null, closed = false;
  const controller = new AbortController();
  const shutdownToken = randomBytes(32).toString('hex');
  async function start() {
    if (closed) throw new DashboardError('统计服务已关闭');
    if (address) return address;
    if (starting) return starting;
    starting = (async () => {
      const executable = await installDashboardRuntime(dataDir, { signal: controller.signal });
      if (closed) throw new DashboardError('统计服务已关闭');
      const instance = spawn(executable, ['--serve', '--host', '127.0.0.1', '--port', '0', '--no-browser', '--no-auto-windows', '--codex-home', codexHome], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, COUSASH_CONFIG_DIR: path.join(dataDir, 'usage-dashboard', 'state'), COUSASH_OWNER_PID: String(process.pid), COUSASH_SHUTDOWN_TOKEN: shutdownToken },
      });
      child = instance;
      instance.once('close', () => { if (child === instance) { child = null; address = null; } });
      return new Promise((resolve, reject) => {
        let output = '';
        const finish = (error, url) => {
          clearTimeout(timer); instance.stdout.off('data', onData); instance.off('error', onError); instance.off('exit', onExit);
          if (error) { instance.kill(); reject(error); }
          else { address = url; instance.stdout.resume(); resolve(url); }
        };
        const onError = () => finish(new DashboardError('统计组件无法启动，请重新安装统计组件'));
        const onExit = () => finish(new DashboardError('统计组件启动失败，请检查数据目录是否可写'));
        const onData = chunk => {
          output = (output + chunk.toString()).slice(-4096);
          const match = output.match(/Codex Usage Dashboard: (http:\/\/127\.0\.0\.1:\d+)\//);
          if (match) finish(null, match[1]);
        };
        const timer = setTimeout(() => finish(new DashboardError('统计组件启动超时，请稍后刷新')), 60000);
        instance.once('error', onError); instance.once('exit', onExit); instance.stdout.on('data', onData);
      });
    })().finally(() => { starting = null; });
    return starting;
  }
  async function close() {
    closed = true; controller.abort();
    const instance = child;
    if (!instance) return;
    const exited = new Promise(resolve => instance.once('close', resolve));
    if (address) {
      try { await fetch(address + '/api/shutdown', { method: 'POST', headers: { Authorization: 'Bearer ' + shutdownToken }, signal: AbortSignal.timeout(1000) }); }
      catch { instance.kill(); }
    } else instance.kill();
    const timer = setTimeout(() => instance.kill(), 1500);
    try { await exited; } finally { clearTimeout(timer); }
  }
  return { start, close };
}
