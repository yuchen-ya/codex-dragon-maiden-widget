const fs = require('node:fs');

class UiStateStore {
  constructor(file) {
    this.file = file;
    try { this.value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { this.value = {}; }
    this.encoded = JSON.stringify(this.value);
    this.dirty = false;
    this.timer = null;
    this.writes = Promise.resolve();
  }
  get() { return this.value; }
  set(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    const accepted = {};
    for (const [key, value] of Object.entries(input)) if (/^dshw[-v]/.test(key) && typeof value === 'string' && value.length < 1024 * 1024) accepted[key] = value;
    const encoded = JSON.stringify(accepted);
    if (encoded === this.encoded) return;
    this.value = accepted; this.encoded = encoded; this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.flush().catch(() => {}); }, 150);
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.dirty) return this.writes;
    const encoded = this.encoded; this.dirty = false;
    this.writes = this.writes.catch(() => {}).then(async () => {
      const temp = this.file + '.' + process.pid + '.tmp';
      try { await fs.promises.writeFile(temp, encoded); await fs.promises.rename(temp, this.file); }
      catch (error) { this.dirty = true; throw error; }
    });
    return this.writes;
  }
}
module.exports = { UiStateStore };
