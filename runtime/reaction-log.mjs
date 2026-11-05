import fs from 'node:fs';
import path from 'node:path';
import { REACTION_QUESTIONS } from './reaction-policy.mjs';

const MAX_BYTES = 1024 * 1024;
const STORAGE_ERRORS = new Set(['ENOSPC', 'EDQUOT', 'EACCES', 'EPERM', 'EROFS', 'ENOENT']);
const dimensions = ['mood', 'intent'];
const count = value => Number.isSafeInteger(value) && value >= 0;

function validStatistics(value) {
  return value?.version === 1 && value.days && typeof value.days === 'object' && !Array.isArray(value.days) &&
    Object.entries(value.days).every(([day, entry]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && count(entry?.total) &&
      dimensions.every(name => entry[name] && typeof entry[name] === 'object' && !Array.isArray(entry[name]) &&
        Object.entries(entry[name]).every(([label, number]) => Object.hasOwn(REACTION_QUESTIONS[name].criteria, label) && count(number)) &&
        Object.values(entry[name]).reduce((sum, number) => sum + number, 0) === entry.total &&
        count(entry.lowConfidence?.[name]) && entry.lowConfidence[name] <= entry.total));
}

// Internal diagnostics contain categories, counts and timings only.
export class ReactionLog {
  constructor({ dataDir, now = Date.now }) {
    this.file = path.join(dataDir, 'jev-reactions.jsonl');
    this.previousFile = path.join(dataDir, 'jev-reactions.previous.jsonl');
    this.statisticsFile = path.join(dataDir, 'jev-statistics.json');
    this.statistics = null;
    this.statisticsError = '';
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
      if (record.event === 'decision' && dimensions.every(name =>
        Object.hasOwn(REACTION_QUESTIONS[name].criteria, record.decisions?.[name]?.choice))) {
        this.countDecision(record.decisions);
      }
    } catch (error) {
      if (!STORAGE_ERRORS.has(error.code)) throw error;
      // A full or unwritable disk must not break the companion's reactions.
      this.error = error.code;
      console.warn('Jev diagnostics disabled: ' + error.code);
    }
  }

  countDecision(decisions) {
    if (this.statisticsError) return;
    if (!this.statistics) {
      if (fs.existsSync(this.statisticsFile)) {
        let saved;
        try { saved = JSON.parse(fs.readFileSync(this.statisticsFile, 'utf8')); }
        catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          this.statisticsError = 'INVALID_JSON';
        }
        if (!this.statisticsError && !validStatistics(saved)) this.statisticsError = 'INVALID_SCHEMA';
        if (this.statisticsError) {
          console.warn('Jev statistics disabled: ' + this.statisticsError);
          return; // Preserve a damaged file for repair; the decision journal still works.
        }
        this.statistics = saved;
      } else this.statistics = { version: 1, days: {} };
    }
    const date = new Date(this.now());
    const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    const entry = this.statistics.days[day] ||= { total: 0, mood: {}, intent: {}, lowConfidence: { mood: 0, intent: 0 } };
    entry.total++;
    for (const name of dimensions) {
      const { choice, probability } = decisions[name];
      entry[name][choice] = (entry[name][choice] || 0) + 1;
      if (probability < .55) entry.lowConfidence[name]++;
    }
    const temporary = this.statisticsFile + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.statistics, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, this.statisticsFile);
  }
}
