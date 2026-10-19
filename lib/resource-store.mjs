import nodeFs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MEDIA_POLICY } from './media-validation.mjs';

export const validResourceId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);
export function resourceError(message, cause) { return new Error(message, cause ? { cause } : undefined); }

export function readResourceJson(file, fallback, validate, { fs = nodeFs, maxBytes = 2 * 1024 * 1024 } = {}) {
  let bytes;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error('invalid file');
    bytes = fs.readFileSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw resourceError(path.basename(file) + ' 不可读；已保留原文件，请检查权限或从 .bak 恢复', error);
  }
  try {
    const parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (!validate(parsed)) throw new Error('invalid data');
    return parsed;
  } catch (error) { throw resourceError(path.basename(file) + ' 已损坏；已保留原文件，请从 .bak 或备份恢复后再编辑', error); }
}

// A sibling temporary file is flushed and renamed; a failed write never
// truncates the live file. The previous complete JSON remains recoverable.
export function atomicResourceWrite(file, bytes, { fs = nodeFs, backup = false, exclusive = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (exclusive && fs.existsSync(file)) throw resourceError('素材文件名冲突，请重试');
  if (backup && fs.existsSync(file)) atomicResourceWrite(file + '.bak', fs.readFileSync(file), { fs });
  const temp = file + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600, flush: true });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    throw resourceError('保存失败，原数据已保留；请检查磁盘空间和文件权限', error);
  }
}

export function writeResourceJson(file, data, { fs = nodeFs } = {}) {
  atomicResourceWrite(file, JSON.stringify(data, null, 2), { fs, backup: true });
  return true;
}

export function resourcePath(dataRoot, directory, id, extension, { fs = nodeFs } = {}) {
  if (!validResourceId(id) || !['png', 'gif', 'jpg', 'webp', 'wav'].includes(extension)) throw resourceError('素材编号或格式无效');
  const base = path.resolve(directory), target = path.resolve(base, id + '.' + extension);
  if (path.dirname(target) !== base) throw resourceError('素材路径越界');
  const rootReal = fs.realpathSync(dataRoot), baseReal = fs.realpathSync(base), relative = path.relative(rootReal, baseReal);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) throw resourceError('素材目录位于挂件数据目录之外');
  try { if (fs.lstatSync(target).isSymbolicLink()) throw resourceError('不允许读取或修改链接素材'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return target;
}

export function pickResourceDirectory(candidates, indexName, { fs = nodeFs } = {}) {
  // Never silently abandon a read-only or corrupt primary index for an empty
  // fallback directory. An existing index owns its library until repaired.
  const existing = candidates.find(dir => fs.existsSync(path.join(dir, indexName))) || candidates.find(dir => fs.existsSync(dir));
  const chosen = existing || candidates[0];
  if (!fs.existsSync(chosen)) fs.mkdirSync(chosen, { recursive: true });
  return chosen;
}

export function checkMediaBudget(dataRoot, addedBytes, currentCount, { fs = nodeFs } = {}) {
  if (currentCount >= MEDIA_POLICY.maxItemsPerLibrary) throw resourceError('此素材库最多 256 项，请先删除不再需要的素材');
  const dirs = ['whale-roles', 'whale-audio', 'whale-bubble-imgs', path.join('profiles', 'web', 'whale-roles'), path.join('profiles', 'web', 'whale-audio')];
  let total = addedBytes;
  const rootReal = fs.realpathSync(dataRoot), visited = new Set();
  for (const dir of dirs) {
    const candidate = path.join(dataRoot, dir);
    if (!fs.existsSync(candidate)) continue;
    const real = fs.realpathSync(candidate), rel = path.relative(rootReal, real);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw resourceError('素材目录位于挂件数据目录之外');
    if (visited.has(real)) continue; visited.add(real);
    for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
      // Include transaction leftovers and metadata too; failed cleanup must
      // not create a way around the cumulative storage limit.
      if (!entry.isFile()) continue;
      total += fs.statSync(path.join(candidate, entry.name)).size;
      if (total > MEDIA_POLICY.maxStorageBytes) throw resourceError('素材总空间最多 256 MiB，请先删除不再需要的素材');
    }
  }
  if (total > MEDIA_POLICY.maxStorageBytes) throw resourceError('素材总空间最多 256 MiB');
}

export function importResource(file, bytes, commitIndex, { fs = nodeFs } = {}) {
  atomicResourceWrite(file, bytes, { fs, exclusive: true });
  try { commitIndex(); }
  catch (error) { try { fs.unlinkSync(file); } catch {} throw error; }
}

export function deleteResource(file, commitIndex, restoreIndex, { fs = nodeFs } = {}) {
  const staged = file + '.' + crypto.randomBytes(6).toString('hex') + '.delete-pending';
  let moved = false, committed = false;
  try {
    try { fs.renameSync(file, staged); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    commitIndex(); committed = true;
    if (moved) fs.unlinkSync(staged);
  } catch (error) {
    try {
      if (moved && fs.existsSync(staged)) fs.renameSync(staged, file);
      if (committed) restoreIndex();
    } catch (restoreError) {
      throw resourceError('删除未能完成，素材或索引备份已保留；请恢复 .bak 和 .delete-pending 文件', restoreError);
    }
    throw resourceError('删除失败，原数据已保留；请检查文件权限', error);
  }
}
