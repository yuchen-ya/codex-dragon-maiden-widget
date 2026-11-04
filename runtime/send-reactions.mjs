import { randomUUID } from 'node:crypto';
import { JevConnectionError } from './jev-connection.mjs';
import { chooseReaction, REACTION_QUESTIONS } from './reaction-policy.mjs';
import { filterReactionText } from './reaction-input.mjs';

const REACTION_WINDOW_MS = 5000;
const COOLDOWN_MS = 10000;

export class SendReactions {
  constructor({ connection, sourceFactory, isBlocked = () => false, now = Date.now, diagnostics = () => {} }) {
    Object.assign(this, { connection, isBlocked, now, diagnostics });
    this.source = sourceFactory({ onSend: event => this.receive(event), onContext: event => this.contextEvent(event),
      onDiagnostic: record => this.diagnostics(record),
      onError: () => { this.error = '发送监听暂不可用'; this.diagnostics({ event: 'source-error' }); } });
    this.enabled = false; this.closed = false; this.visible = false; this.blocked = false;
    this.seen = new Set(); this.requests = []; this.notice = null; this.active = null;
    this.lastShown = -Infinity; this.lastLineId = ''; this.backoffUntil = 0; this.authFailed = false;
    this.epoch = 0; this.error = ''; this.latestId = null; this.lastDecision = '';
    this.externalBlocked = false;
  }
  configure() {
    this.invalidate('configuration'); this.source.stop(); this.seen.clear(); this.requests = [];
    this.authFailed = false; this.backoffUntil = 0; this.error = ''; this.latestId = null;
    this.enabled = !this.closed && this.connection.store.load().enabled;
    this.diagnostics({ event: 'configured', enabled: this.enabled });
    if (this.enabled) this.source.start();
  }
  invalidate(reason = 'context-changed') {
    this.epoch++;
    if (this.active) {
      this.diagnostics({ event: 'cancelled', trace: this.active.trace, reason });
      this.active.controller.abort();
    }
    if (this.notice) this.diagnostics({ event: 'discarded', trace: this.notice.trace, reason });
    this.active = null; this.notice = null;
  }
  close() { this.closed = true; this.enabled = false; this.invalidate('shutdown'); this.source.stop(); this.seen.clear(); }
  contextEvent(event) {
    this.invalidate('new-send');
    this.latestId = event.type === 'send' ? event.id : null;
  }
  setContext({ visible, blocked }) {
    if ((!visible && this.visible) || (blocked && !this.blocked)) this.invalidate(!visible ? 'hidden' : 'ui-blocked');
    this.visible = visible; this.blocked = blocked;
  }
  unavailableReason() {
    if (!this.enabled) return 'disabled';
    if (!this.visible) return 'hidden';
    if (this.blocked) return 'ui-blocked';
    const externalBlocked = this.isBlocked();
    if (externalBlocked && !this.externalBlocked) this.invalidate('business-notice');
    this.externalBlocked = externalBlocked;
    return externalBlocked ? 'business-notice' : '';
  }
  unavailable() { return Boolean(this.unavailableReason()); }
  async receive(event) {
    if (this.latestId !== event.id) this.contextEvent({ type: 'send', id: event.id });
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);
    if (this.seen.size > 1024) this.seen.delete(this.seen.values().next().value);
    const at = this.now();
    const trace = event.trace || randomUUID();
    const skip = reason => { this.lastDecision = reason; this.diagnostics({ event: 'skipped', trace, reason }); };
    this.diagnostics({ event: 'received', trace });
    const blocked = this.unavailableReason();
    if (blocked) return skip(blocked);
    if (this.authFailed) return skip('authentication-stopped');
    if (at < this.backoffUntil) return skip('error-backoff');
    if (!Number.isFinite(event.at) || event.at > at + 1000) return skip('invalid-time');
    if (at - event.at >= REACTION_WINDOW_MS) return skip('stale');
    // Do not pay for a judgment that cannot produce a visible reaction.
    if (at - this.lastShown < COOLDOWN_MS) return skip('cooldown');
    const text = event.text.replace(/\r\n/g, '\n').trim().normalize('NFC');
    if (!text) return skip('empty');
    if ([...text].length > 300) return skip('too-long');
    const input = filterReactionText(text);
    if (input.filtered.numbers || input.filtered.secrets) {
      this.diagnostics({ event: 'input-filtered', trace, ...input.filtered });
    }
    if (!input.meaningful) return skip('no-analyzable-text');
    const state = { route: 'user_only', user_message: input.text };
    if (event.recommendations?.length) {
      const recommendations = event.recommendations.map(value => value.replace(/\r\n/g, '\n').trim().normalize('NFC'));
      if (!input.filtered.numbers && !input.filtered.secrets && recommendations.every(value => value && [...value].length <= 300) &&
          recommendations.reduce((sum, value) => sum + [...value].length, 0) <= 900 &&
          recommendations.every(value => { const checked = filterReactionText(value); return !checked.filtered.numbers && !checked.filtered.secrets; })) {
        Object.assign(state, { route: 'paired', recommendations, local_comparison: recommendations.includes(text) ? 'exact' : 'different' });
      }
    }
    this.requests = this.requests.filter(time => at - time < 60000);
    if (this.requests.length >= 30) return skip('rate-limited');
    this.requests.push(at);
    const epoch = this.epoch, controller = new AbortController();
    this.active = { controller, trace };
    const timeoutMs = Math.max(1, REACTION_WINDOW_MS - Math.max(0, at - event.at) - 250);
    this.diagnostics({ event: 'request-started', trace, route: state.route, characters: [...text].length,
      ageMs: Math.max(0, at - event.at), timeoutMs });
    try {
      const result = await this.connection.decide(state, REACTION_QUESTIONS, { signal: controller.signal, timeoutMs });
      if (epoch !== this.epoch || controller.signal.aborted) return;
      if (!result) return skip('disabled');
      const blockedAfterRequest = this.unavailableReason();
      if (blockedAfterRequest) return skip(blockedAfterRequest);
      if (this.now() - event.at >= REACTION_WINDOW_MS) return skip('result-expired');
      const line = chooseReaction(result, state, this.lastLineId);
      this.error = ''; this.lastDecision = line ? 'eligible' : 'silent';
      const decisions = Object.fromEntries(Object.entries(REACTION_QUESTIONS).map(([name, question]) => {
        const answer = result.answers[name];
        return [name, question.type === 'noul' ? answer.noul : { choice: answer.choice, probability: answer.probabilities[answer.choice] }];
      }));
      this.diagnostics({ event: 'decision', trace, elapsedMs: this.now() - at, decisions,
        lineId: line?.id || null, reason: line ? 'eligible' : result.answers.hold_back.noul >= 0.5 ? 'hold-back' :
          result.answers.occasion.probabilities[result.answers.occasion.choice] < 0.55 ? 'low-confidence' : 'no-matching-occasion' });
      if (!line) return;
      this.notice = { id: randomUUID(), trace, tone: line.tone, text: line.text, lineId: line.id, expiresAt: event.at + REACTION_WINDOW_MS };
      this.diagnostics({ event: 'notice-ready', trace, lineId: line.id });
    } catch (error) {
      if (!(error instanceof JevConnectionError)) throw error;
      if (epoch !== this.epoch || controller.signal.aborted) return;
      this.diagnostics({ event: 'request-error', trace, elapsedMs: this.now() - at,
        code: /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'UNKNOWN' });
      this.error = error.message;
      if (['NO_KEY', 'HTTP_401', 'HTTP_403'].includes(error.code)) this.authFailed = true;
      else this.backoffUntil = this.now() + 30000;
      this.lastDecision = 'error';
    } finally { if (this.active?.controller === controller) this.active = null; }
  }
  poll(context) {
    this.setContext(context);
    const blocked = this.unavailableReason();
    if (this.notice && (blocked || this.now() >= this.notice.expiresAt)) {
      this.diagnostics({ event: 'discarded', trace: this.notice.trace, reason: blocked || 'display-expired' });
      this.notice = null;
    }
    const notice = this.notice && { id: this.notice.id, tone: this.notice.tone, text: this.notice.text, expiresAt: this.notice.expiresAt };
    return { ok: true, enabled: this.enabled, revision: this.epoch, notice };
  }
  acknowledge({ id, shown }) {
    if (typeof id !== 'string' || typeof shown !== 'boolean') throw new Error('反应确认参数无效');
    if (this.notice?.id !== id) return;
    const notice = this.notice;
    const displayed = shown && this.now() < notice.expiresAt && !this.unavailable();
    this.diagnostics({ event: displayed ? 'shown' : 'discarded', trace: notice.trace, lineId: notice.lineId,
      ...(displayed ? {} : { reason: shown ? 'display-expired-or-blocked' : 'renderer-rejected' }) });
    if (displayed) {
      this.lastShown = this.now(); this.lastLineId = notice.lineId;
    }
    this.notice = null;
  }
  status() {
    return { enabled: this.enabled, source: this.source.status(), error: this.error,
      lastDecision: this.lastDecision, waiting: !!this.active };
  }
}
