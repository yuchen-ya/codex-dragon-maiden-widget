import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MEDIA_POLICY, validateImage, validateWav } from './media-validation.mjs';
import { validResourceId, readResourceJson, atomicResourceWrite, resourcePath, checkMediaBudget } from './resource-store.mjs';
import { BUILTIN_ROLES, defaultRolesIndex } from './builtin-roles.mjs';

export const WORKSHOP_MAX_BYTES = 24 * 1024 * 1024;
const schema = 'api-balance-whale-workshop';
const fail = message => { throw new Error('创意工坊：' + message); };
const presets = ['ya1', 'ya2', 'd1', 'd2'];
const ext = format => ({ jpeg: 'jpg', apng: 'png' }[format] || format || 'png');
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('存在不支持的字段');
}
function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\x00-\x1f]/.test(value)) fail('名称无效');
  return value.trim();
}
function list(value) {
  if (!Array.isArray(value) || value.length > MEDIA_POLICY.maxItemsPerLibrary) fail('每类最多 256 项');
  const seen = new Set();
  for (const item of value) {
    if (!item || !validResourceId(item.id) || seen.has(item.id)) fail('素材编号无效或重复');
    seen.add(item.id);
  }
  return value;
}
export function validateWorkshop(input, { presetFragmentIds = presets } = {}) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  if (!text || Buffer.byteLength(text) > WORKSHOP_MAX_BYTES) fail('包文件最多 24 MiB');
  const pack = JSON.parse(text);
  keys(pack, ['schema', 'version', 'roles', 'images', 'fragments', 'groups']);
  if (pack.schema !== schema || pack.version !== 1) fail('包版本不受支持');
  let bytes = 0;
  const media = {};
  for (const kind of ['roles', 'images', 'fragments']) {
    media[kind] = list(pack[kind]).map(item => {
      keys(item, ['id', 'name', 'format', 'data']);
      name(item.name);
      const limit = kind === 'roles' ? MEDIA_POLICY.roleBytes : kind === 'images' ? MEDIA_POLICY.bubbleBytes : MEDIA_POLICY.audioBytes;
      if (typeof item.data !== 'string' || item.data.length > Math.ceil(limit / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data)) fail('媒体编码无效或过大');
      const buffer = Buffer.from(item.data, 'base64');
      const info = kind === 'fragments' ? validateWav(buffer) : validateImage(buffer, { maxBytes: limit });
      if (item.format !== info.format) fail('媒体声明格式不匹配');
      bytes += buffer.length;
      return { ...item, name: name(item.name), buffer, info };
    });
  }
  const refs = new Set([...presetFragmentIds, ...media.fragments.map(f => f.id), '']);
  for (const group of list(pack.groups)) {
    keys(group, ['id', 'name', 'press', 'release']); name(group.name);
    if (!refs.has(group.press) || !refs.has(group.release)) fail('音效组引用了缺失片段');
  }
  return { pack, media, bytes };
}
function libraries(root) {
  const defs = [
    ['roles', 'whale-roles', 'roles.json', defaultRolesIndex()],
    ['audio', 'whale-audio', 'audio.json', { version: 1, groups: [], fragments: [] }],
    ['images', 'whale-bubble-imgs', 'bubble-imgs.json', { version: 1, images: [] }],
  ];
  return Object.fromEntries(defs.map(([kind, folder, index, fallback]) => {
    const candidates = [path.join(root, folder), ...(kind === 'images' ? [] : [path.join(root, 'profiles', 'web', folder)])];
    const dir = candidates.find(d => fs.existsSync(path.join(d, index))) || candidates.find(d => fs.existsSync(d)) || candidates[0];
    // Resolve the closest existing ancestor before any directory creation.
    let ancestor = dir;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const relative = path.relative(fs.realpathSync(root), fs.realpathSync(ancestor));
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) fail('素材目录越界');
    const file = path.join(dir, index);
    const data = readResourceJson(file, fallback, value => {
      try { for (const key of kind === 'audio' ? ['fragments', 'groups'] : [kind]) list(value[key]); return value.version === 1; } catch { return false; }
    });
    return [kind, { dir, file, data }];
  }));
}
export function importWorkshop(dataRoot, input, options = {}) {
  const { pack, media, bytes } = validateWorkshop(input, options);
  const libs = libraries(dataRoot);
  for (const kind of ['roles', 'images', 'fragments', 'groups']) {
    const library = libs[kind === 'fragments' || kind === 'groups' ? 'audio' : kind];
    if (library.data[kind].length + pack[kind].length > MEDIA_POLICY.maxItemsPerLibrary) fail('导入后素材库将超过 256 项');
  }
  checkMediaBudget(dataRoot, bytes + Buffer.byteLength(JSON.stringify(pack.groups)), 0);
  const idMap = Object.fromEntries(['roles', 'images', 'fragments', 'groups'].map(k => [k, Object.create(null)]));
  for (const kind of Object.keys(idMap)) for (const item of pack[kind]) idMap[kind][item.id] = 'w_' + crypto.randomUUID().replaceAll('-', '');
  const written = [], changed = [], originals = new Map();
  const now = Date.now();
  try {
    for (const lib of Object.values(libs)) {
      originals.set(lib.file, fs.existsSync(lib.file) ? fs.readFileSync(lib.file) : null);
      fs.mkdirSync(lib.dir, { recursive: true });
    }
    for (const kind of ['roles', 'images', 'fragments']) {
      const lib = libs[kind === 'fragments' ? 'audio' : kind];
      for (const item of media[kind]) {
        const id = idMap[kind][item.id];
        const file = resourcePath(dataRoot, lib.dir, id, ext(item.format));
        atomicResourceWrite(file, item.buffer, { exclusive: true }); written.push(file);
        lib.data[kind].push({ id, name: item.name, format: item.format, createdAt: now, ...(kind === 'fragments' ? { duration: item.info.duration } : {}) });
      }
    }
    for (const group of pack.groups) libs.audio.data.groups.push({ id: idMap.groups[group.id], name: name(group.name), press: idMap.fragments[group.press] || group.press, release: idMap.fragments[group.release] || group.release, createdAt: now });
    for (const [kind, lib] of Object.entries(libs)) {
      // In-process test seam; never read callbacks from package JSON.
      options.beforeIndexWrite?.(kind);
      atomicResourceWrite(lib.file, JSON.stringify(lib.data, null, 2)); changed.push(lib.file);
    }
  } catch (error) {
    const failures = [];
    for (const file of changed.reverse()) try { const old = originals.get(file); if (old === null) fs.unlinkSync(file); else atomicResourceWrite(file, old); } catch (e) { failures.push(e); }
    for (const file of written) try { fs.unlinkSync(file); } catch (e) { failures.push(e); }
    if (failures.length) throw new AggregateError([error, ...failures], '创意工坊回滚未完成，请恢复备份后重试');
    throw error;
  }
  return { ok: true, counts: Object.fromEntries(Object.keys(idMap).map(k => [k, pack[k].length])), idMap };
}
export function exportWorkshop(dataRoot, options = {}) {
  const libs = libraries(dataRoot);
  const pack = { schema, version: 1, roles: [], images: [], fragments: [], groups: [] };
  let size = 0;
  for (const kind of ['roles', 'images', 'fragments']) {
    const lib = libs[kind === 'fragments' ? 'audio' : kind];
    for (const item of lib.data[kind]) {
      if (kind === 'roles' && BUILTIN_ROLES.some(role => role.id === item.id)) continue;
      const format = kind === 'fragments' ? 'wav' : item.format || 'png';
      const file = resourcePath(dataRoot, lib.dir, item.id, ext(format));
      const stat = fs.lstatSync(file);
      size += Math.ceil(stat.size / 3) * 4;
      if (!stat.isFile() || size > WORKSHOP_MAX_BYTES) fail('媒体包过大或文件无效');
      pack[kind].push({ id: item.id, name: name(item.name), format, data: fs.readFileSync(file).toString('base64') });
    }
  }
  pack.groups = libs.audio.data.groups.map(g => ({ id: g.id, name: name(g.name), press: g.press || '', release: g.release || '' }));
  validateWorkshop(pack, options);
  return pack;
}
