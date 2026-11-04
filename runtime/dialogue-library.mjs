import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import core from '../lib/dialogue-core.cjs';

export const BUILTIN_DIALOGUE_FILE = fileURLToPath(new URL('../assets/dialogue-library.json', import.meta.url));

export function loadDialogueLibrary({ dataDir, file = BUILTIN_DIALOGUE_FILE } = {}) {
  if (dataDir) {
    const personal = path.join(dataDir, 'dialogue-custom.json');
    // This is user content: initialize once, never overwrite it on an update.
    if (!fs.existsSync(personal)) {
      try { fs.copyFileSync(file, personal, fs.constants.COPYFILE_EXCL); }
      catch (error) { if (!['EEXIST', 'ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'EDQUOT'].includes(error.code)) throw error; }
    }
    if (fs.existsSync(personal)) file = personal;
  }
  let value;
  try {
    if (fs.statSync(file).size > 1024 * 1024) {
      console.warn('Dialogue library ignored: FILE_TOO_LARGE');
      return core.normalizeLibrary(null);
    }
    value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if (!(error instanceof SyntaxError) && !['ENOENT', 'EACCES', 'EPERM', 'EISDIR'].includes(error.code)) throw error;
    console.warn('Dialogue library unavailable: ' + (error instanceof SyntaxError ? 'INVALID_JSON' : error.code));
    return core.normalizeLibrary(null);
  }
  const library = core.normalizeLibrary(value);
  if (library.rejected) console.warn('Dialogue library entries ignored: ' + library.rejected);
  return library;
}
