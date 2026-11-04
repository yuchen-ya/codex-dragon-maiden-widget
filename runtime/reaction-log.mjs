import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 1024 * 1024;
const STORAGE_ERRORS = new Set(['ENOSPC', 'EDQUOT', 'EACCES', 'EPERM', 'EROFS', 'ENOENT']);

// Internal diagnostics contain categories, counts and timings only.
export class ReactionLog {
  constructor({ dataDir, now = Date.now }) {
    this.file = path.join(dataDir, 'jev-reactions.jsonl');
    this.previousFile = path.join(dataDir, 'jev-reactions.previous.jsonl');
    this.now = now;
    this.error = '';
    this.run = process.pid + '-' + this.now();
  }

  write(record) {
    if (this.error) return;
    const line = JSON.stringify({ at: this.now(), run: this.run, ...record }) + '\n';
    try {
      const size = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
      if (size + Buffer.byteLength(line) > MAX_BYTES) {
        if (fs.existsSync(this.previousFile)) fs.unlinkSync(this.previousFile);
        fs.renameSync(this.file, this.previousFile);
      }
      fs.appendFileSync(this.file, line, { mode: 0o600 });
    } catch (error) {
      if (!STORAGE_ERRORS.has(error.code)) throw error;
      // A full or unwritable disk must not break the companion's reactions.
      this.error = error.code;
      console.warn('Jev diagnostics disabled: ' + error.code);
    }
  }
}
