import path from 'node:path';
import { DATA_HOME, readJson, writeJson } from './paths.mjs';
import { checkFields, cleanUrl, environmentName, readEnvironment, textValue } from './config-connections.mjs';

export const JEV_PRESETS = Object.freeze({
  openrouter: { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.13', keyEnv: 'OPENROUTER_API_KEY' },
  typesafe: { name: 'TypeSafe 官方', endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest', keyEnv: 'TYPESAFE_API_KEY' },
  custom: { name: '其他兼容服务', endpoint: '', model: '', keyEnv: '' },
});

export const DEFAULT_JEV_SETTINGS = Object.freeze({
  enabled: false,
  provider: 'openrouter', endpoint: JEV_PRESETS.openrouter.endpoint,
  model: JEV_PRESETS.openrouter.model, keyEnv: JEV_PRESETS.openrouter.keyEnv,
  network: { mode: 'direct', proxyUrl: '' },
});

function proxyUrl(value) {
  const text = textValue(value, 2048, '代理地址');
  if (!text) return '';
  let url;
  try { url = new URL(text); } catch { throw new Error('代理地址须为完整的 HTTP 或 HTTPS 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/' || /[\\\s]/.test(text)) {
    throw new Error('代理地址只支持 HTTP 或 HTTPS，不含账号密码、路径和查询参数');
  }
  return url.origin;
}

export function validateJevSettings(input) {
  checkFields(input, Object.keys(DEFAULT_JEV_SETTINGS), 'Jev 设置');
  const settings = { ...structuredClone(DEFAULT_JEV_SETTINGS), ...input };
  if (typeof settings.enabled !== 'boolean') throw new Error('情境反应开关必须为布尔值');
  if (typeof settings.provider !== 'string' || !Object.hasOwn(JEV_PRESETS, settings.provider)) throw new Error('未知 Jev 服务商');
  settings.endpoint = cleanUrl(settings.endpoint);
  settings.model = textValue(settings.model, 150, 'Jev 模型');
  if (!settings.model) throw new Error('请填写 Jev 模型名称');
  settings.keyEnv = environmentName(settings.keyEnv);
  if (!settings.keyEnv) throw new Error('请填写 Jev 密钥环境变量名称');
  checkFields(settings.network, ['mode', 'proxyUrl'], 'Jev 网络设置');
  if (!['direct', 'proxy'].includes(settings.network.mode)) throw new Error('请选择直连或指定代理');
  settings.network = { mode: settings.network.mode, proxyUrl: proxyUrl(settings.network.proxyUrl) };
  if (settings.network.mode === 'proxy' && !settings.network.proxyUrl) throw new Error('使用代理时必须填写代理地址');
  return settings;
}

export class JevSettingsStore {
  constructor({ dataDir = DATA_HOME, env = process.env } = {}) {
    this.file = path.join(dataDir, 'jev-settings.json');
    this.env = env;
  }
  load() { return validateJevSettings(readJson(this.file, DEFAULT_JEV_SETTINGS)); }
  prepare(patch) {
    checkFields(patch, Object.keys(DEFAULT_JEV_SETTINGS), 'Jev 设置');
    const current = this.load();
    if (Object.hasOwn(patch, 'provider') && patch.provider !== current.provider &&
        !['endpoint', 'model', 'keyEnv'].every(field => Object.hasOwn(patch, field))) {
      throw new Error('切换服务商时请同时确认接口地址、模型和密钥环境变量');
    }
    return validateJevSettings({ ...current, ...patch,
      network: Object.hasOwn(patch, 'network') ? patch.network : current.network });
  }
  save(patch) {
    const settings = this.prepare(patch);
    writeJson(this.file, settings);
    return settings;
  }
  info() {
    const settings = this.load();
    return { settings, keyConfigured: !!readEnvironment(this.env, settings.keyEnv), presets: JEV_PRESETS };
  }
}
