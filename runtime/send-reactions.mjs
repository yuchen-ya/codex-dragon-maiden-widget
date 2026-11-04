import { randomUUID } from 'node:crypto';
import { JevConnectionError } from './jev-connection.mjs';
import { chooseReaction, REACTION_QUESTIONS } from './reaction-policy.mjs';

export class SendReactions {
  constructor({ connection, sourceFactory, isBlocked = () => false, now = Date.now }) {
    Object.assign(this, { connection, isBlocked, now });
    this.source = sourceFactory({ onSend: event => this.receive(event), onContext: event => this.contextEvent(event),
      onError: () => { this.error = '发送监听暂不可用'; } });
    this.enabled = false; this.closed = false; this.visible = false; this.blocked = false;
    this.seen = new Set(); this.requests = []; this.notice = null; this.active = null;
    this.lastShown = -Infinity; this.lastLineId = ''; this.backoffUntil = 0; this.authFailed = false;
    this.epoch = 0; this.error = ''; this.latestId = null; this.lastDecision = '';
    this.externalBlocked = false;
  }
  configure() {
    this.invalidate(); this.source.stop(); this.seen.clear(); this.requests = [];
    this.authFailed = false; this.backoffUntil = 0; this.error = ''; this.latestId = null;
    this.enabled = !this.closed && this.connection.store.load().enabled;
    if (this.enabled) this.source.start();
  }
  invalidate() { this.epoch++; this.active?.abort(); this.active = null; this.notice = null; }
  close() { this.closed = true; this.enabled = false; this.invalidate(); this.source.stop(); this.seen.clear(); }
  contextEvent(event) {
    this.invalidate();
    this.latestId = event.type === 'send' ? event.id : null;
  }
  setContext({ visible, blocked }) {
    if ((!visible && this.visible) || (blocked && !this.blocked)) this.invalidate();
    this.visible = visible; this.blocked = blocked;
  }
  unavailable() {
    if (!this.enabled || !this.visible || this.blocked) return true;
    const externalBlocked = this.isBlocked();
    if (externalBlocked && !this.externalBlocked) this.invalidate();
    this.externalBlocked = externalBlocked;
    return externalBlocked;
  }
  async receive(event) {
    if (this.latestId !== event.id) this.contextEvent({ type: 'send', id: event.id });
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);
    if (this.seen.size > 1024) this.seen.delete(this.seen.values().next().value);
    const at = this.now();
    if (this.unavailable() || this.authFailed || at < this.backoffUntil ||
        !Number.isFinite(event.at) || event.at > at + 1000 || at - event.at >= 2000) return;
    const text = event.text.replace(/\r\n/g, '\n').trim().normalize('NFC');
    if (!text || [...text].length > 300) return;
    const state = { route: 'user_only', user_message: text };
    if (event.recommendations?.length) {
      const recommendations = event.recommendations.map(value => value.replace(/\r\n/g, '\n').trim().normalize('NFC'));
      if (recommendations.every(value => value && [...value].length <= 300) && recommendations.reduce((sum, value) => sum + [...value].length, 0) <= 900) {
        Object.assign(state, { route: 'paired', recommendations, local_comparison: recommendations.includes(text) ? 'exact' : 'different' });
      }
    }
    this.requests = this.requests.filter(time => at - time < 60000);
    if (this.requests.length >= 30) { this.lastDecision = 'rate-limited'; return; }
    this.requests.push(at);
    const epoch = this.epoch, controller = new AbortController();
    this.active = controller;
    try {
      const result = await this.connection.decide(state, REACTION_QUESTIONS, { signal: controller.signal, timeoutMs: 2000 - (at - event.at) });
      if (!result || epoch !== this.epoch || controller.signal.aborted || this.unavailable() || this.now() - event.at >= 2000) return;
      const line = chooseReaction(result, state, this.lastLineId);
      this.error = ''; this.lastDecision = line ? 'eligible' : 'silent';
      if (!line || this.now() - this.lastShown < 10000) return;
      this.notice = { id: randomUUID(), tone: line.tone, text: line.text, lineId: line.id, expiresAt: event.at + 2000 };
    } catch (error) {
      if (!(error instanceof JevConnectionError)) throw error;
      if (epoch !== this.epoch || controller.signal.aborted) return;
      this.error = error.message;
      if (['NO_KEY', 'HTTP_401', 'HTTP_403'].includes(error.code)) this.authFailed = true;
      else this.backoffUntil = this.now() + 30000;
      this.lastDecision = 'error';
    } finally { if (this.active === controller) this.active = null; }
  }
  poll(context) {
    this.setContext(context);
    if (this.unavailable() || this.notice && this.now() >= this.notice.expiresAt) this.notice = null;
    const notice = this.notice && { id: this.notice.id, tone: this.notice.tone, text: this.notice.text, expiresAt: this.notice.expiresAt };
    return { ok: true, enabled: this.enabled, revision: this.epoch, notice };
  }
  acknowledge({ id, shown }) {
    if (typeof id !== 'string' || typeof shown !== 'boolean') throw new Error('反应确认参数无效');
    if (this.notice?.id !== id) return;
    if (shown && this.now() < this.notice.expiresAt && !this.unavailable()) {
      this.lastShown = this.now(); this.lastLineId = this.notice.lineId;
    }
    this.notice = null;
  }
  status() {
    return { enabled: this.enabled, source: this.source.status(), error: this.error,
      lastDecision: this.lastDecision, waiting: !!this.active };
  }
}
