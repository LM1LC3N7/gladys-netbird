// -----------------------------------------------------------------------------
// NetbirdApp: the integration. One NetBird account, its peers. Read only.
//
//   start(config)  (re)connects: the user of the token checked, the peers
//                  read, Discovery published, the loop started
//   loop           every `poll_interval` s (60 by default): GET /api/peers
//                  -> connected, last seen, IP, version, login expired /
//                  expiry, the counts of the network, and the triggers
//                  `peer_connected`, `peer_disconnected`, `peer_login_expired`;
//                  the account settings (login expiration) once an hour
//   failures       a token refused (401, or 403 in the envelope of the API, on
//                  /api/peers only) stops everything until the configuration is
//                  saved; HTTP 429 and 5xx pause every request (bounded, kept
//                  in /data); anything else is retried, never faster than the
//                  poll interval, doubling up to 30 min
//
// The loop is one chain of timers: halt() bumps an epoch, and a run of an
// older epoch (still in flight when NetBird failed) never schedules itself
// again.
// -----------------------------------------------------------------------------

import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { Budget } from './budget.js';
import { matchesFilter, normalizeConfig } from './config.js';
import { FEATURES, INTERVALS, LIMITS, SCENE_TRIGGERS, STORE_FILE } from './constants.js';
import {
  buildNetworkDevice,
  buildPeerDevice,
  createdDevices,
  networkIds,
  peerIds,
} from './devices.js';
import { T } from './i18n.js';
import { Store } from './store.js';
import { NetbirdClient } from './netbird/client.js';
import { CODES, isTokenRefused } from './netbird/errors.js';
import { httpRequest } from './netbird/http.js';
import { formatDate, loginExpiry } from './netbird/parse.js';

/** The "Test the connection" button waits 30 s: answer before. */
const TEST_BUDGET_MS = 25_000;
/** Entries per publishTransports call (the SDK refuses more). */
export const TRANSPORTS_PER_CALL = 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
/** The value of a state entry, number or text, as one comparable key. */
const valueOf = (s) => (s.text !== undefined ? `t:${s.text}` : `s:${s.state}`);

export class NetbirdApp {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {object} [options.logger]
   * @param {Function} [options.request] the HTTP transport (tests inject a fake NetBird)
   * @param {string} [options.dataDir] the writable volume
   * @param {() => number} [options.now]
   * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
   */
  constructor({
    gladys,
    logger = createLogger({ name: 'netbird' }),
    request = httpRequest,
    dataDir = process.env.DATA_DIR ?? '/data',
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.request = request;
    this.now = now;
    this.timers = timers;
    this.store = new Store({ filePath: join(dataDir, STORE_FILE), logger });
    this.budget = new Budget({ perMinute: LIMITS.STATES_PER_MINUTE, now });
    this.rawConfig = {};
    this.config = normalizeConfig();
    this.client = null;
    this.generation = 0;
    this.epoch = 0;
    this.handles = new Set();
    this.queue = Promise.resolve();
    this.lastStatus = null;
    /**
     * The last peers read, with the server and filter they belong to: kept
     * across a restart of the app (a reconnection to Gladys during a pause
     * republishes Discovery from them).
     */
    this.known = null;
    /**
     * After a failed reading: { key (HMAC of address and token), at, delay,
     * message }, kept across a restart of the app so that a reconnection to
     * Gladys does not skip the wait. In memory only.
     */
    this.retryWait = null;
    /** Values last accepted by Gladys (feature -> value), to budget only changes. */
    this.published = new Map();
    /** Where the next cut of the texts starts (they take turns under the budget). */
    this.textCursor = 0;
    /** The reading in flight: one at a time (loop, Discovery). */
    this.reading = null;
    this.reset();
  }

  reset() {
    this.online = false;
    this.blocked = false;
    this.pausedUntil = 0;
    this.retryDelay = this.minRetry();
    /** id -> peer, the followed peers of the last reading. */
    this.peers = new Map();
    /** Matching peers above the cap of LIMITS.PEERS. */
    this.capped = 0;
    this.counts = null;
    /** A reading to compare with: false at start and after any failure (no event then). */
    this.baseline = false;
    this.account = null;
    this.accountAt = null;
    this.user = null;
    this.discoveredKey = null;
    this.transports = new Map();
    this.published.clear();
  }

  /** A failure is never read again faster than the poll interval. */
  minRetry() {
    return Math.max(INTERVALS.RETRY_MIN_MS, (this.config?.pollSeconds ?? 60) * 1000);
  }

  pollMs() {
    return this.config.pollSeconds * 1000;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Run `task` after every start / restart already queued. */
  enqueue(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * (Re)start with a configuration. Calls are serialized. `force`: the user
   * saved the configuration: a token refused earlier is tried again.
   * `immediate`: read now even within the retry wait of a failure (the test
   * button); neither lifts a pause asked by NetBird.
   */
  start(rawConfig, { force = false, immediate = false } = {}) {
    return this.enqueue(() => this.run(rawConfig, { force, immediate }));
  }

  /** The values a refusal is about (HMAC with the salt of /data: never the token). */
  async refusalKey(config) {
    return createHmac('sha256', await this.store.salt())
      .update(JSON.stringify([config.server.base, config.token]))
      .digest('hex');
  }

  /** What the known peers belong to (never the token). */
  knownKey(config) {
    return JSON.stringify([
      config.server?.base,
      config.filter ? [...config.filter.names].sort() : null,
    ]);
  }

  async stop() {
    this.generation += 1;
    this.halt();
    this.dropClient();
  }

  /** Clear every timer; the runs still in flight will not schedule again. */
  halt() {
    this.epoch += 1;
    for (const handle of this.handles) this.timers.clearTimeout(handle);
    this.handles.clear();
  }

  dropClient() {
    this.client?.close();
    this.client = null;
  }

  async run(rawConfig, { force = false, immediate = false } = {}) {
    this.halt();
    this.dropClient();
    const generation = ++this.generation;
    this.rawConfig = rawConfig ?? {};
    const config = normalizeConfig(rawConfig);
    this.config = config;
    this.reset();
    // The core keeps the status and Discovery in memory: a start (a
    // reconnection to Gladys included) always sends them again.
    this.lastStatus = null;
    if (this.known && this.known.key !== this.knownKey(config)) this.known = null;
    await this.store.load();

    if (config.urlError) {
      const message = { http: T.status.urlHttp, credentials: T.status.urlCredentials }[
        config.urlError
      ];
      await this.stopWith(message ?? T.status.urlInvalid);
      return;
    }
    if (!config.token) {
      await this.stopWith(T.status.missingToken);
      return;
    }
    if (config.tokenInvalid) {
      await this.stopWith(T.status.tokenInvalid);
      return;
    }
    if (config.fingerprintInvalid) {
      await this.stopWith(T.status.fingerprintInvalid);
      return;
    }
    // A token NetBird refused with these very values is not tried again
    // before the configuration is saved.
    const base = config.server.base;
    const refused = this.store.get('refusals', base);
    if (refused && refused === (await this.refusalKey(config)) && !force) {
      this.blocked = true;
      this.logger.warn('Access token refused earlier: not tried again');
      await this.stopWith(T.status.tokenRefused);
      return;
    }
    if (refused) await this.store.set('refusals', base, null);
    this.client = new NetbirdClient({
      server: config.server,
      token: config.token,
      fingerprint: config.fingerprint,
      request: this.request,
    });
    this.logger.info(`Using the NetBird management API at ${config.server.origin}`);
    // A pause (HTTP 429 or 5xx) outlives a restart, a reconnection to Gladys
    // and a saved configuration; its end is capped (a clock jump, a file
    // written by hand).
    const stored = Number(this.store.get('meta', this.pauseKey())) || 0;
    const pausedUntil = Math.min(stored, this.now() + INTERVALS.BUSY_MAX_MS);
    // The capped end is written back: the next reading of the file (another
    // restart) does not cap from a later "now" again.
    if (pausedUntil < stored) await this.store.set('meta', this.pauseKey(), String(pausedUntil));
    if (this.now() < pausedUntil) {
      this.pausedUntil = pausedUntil;
      const delay = pausedUntil - this.now();
      if (this.known) {
        for (const peer of this.known.peers) this.peers.set(peer.id, peer);
        await this.publishDiscovered();
      }
      await this.publishTransports();
      await this.setStatus(false, T.status.paused(delay));
      this.schedule(delay, () => this.connect(generation));
      return;
    }
    // After a failed reading, a reconnection to Gladys waits for the retry
    // like the loop would (never faster than the interval); the button and
    // a saved configuration read at once.
    const waiting = this.retryWait;
    if (!force && !immediate && waiting?.key === (await this.refusalKey(config))) {
      if (this.now() < waiting.at) {
        this.retryDelay = waiting.delay;
        if (this.known) {
          for (const peer of this.known.peers) this.peers.set(peer.id, peer);
          await this.publishDiscovered();
        }
        await this.publishTransports();
        await this.setStatus(false, waiting.message);
        this.schedule(waiting.at - this.now(), () => this.connect(generation));
        return;
      }
      this.retryDelay = waiting.delay;
    }
    await this.connect(generation);
  }

  pauseKey() {
    return `pausedUntil|${this.config.server?.base}`;
  }

  /** Stopped before any request (configuration, refused token): status and badges. */
  async stopWith(message) {
    await this.publishTransports();
    await this.setStatus(false, message);
  }

  schedule(delay, task) {
    const handle = this.timers.setTimeout(async () => {
      this.handles.delete(handle);
      try {
        await task();
      } catch (err) {
        this.logger.error('Loop failed', err);
      }
    }, delay);
    this.handles.add(handle);
    return handle;
  }

  /** Schedule the next reading of the current epoch. */
  scheduleLoop(delay, generation) {
    const epoch = this.epoch;
    this.schedule(delay, () => this.loop(generation, epoch));
  }

  /** May a loop of this generation and epoch schedule its next run? */
  current(generation, epoch) {
    return generation === this.generation && epoch === this.epoch && !this.blocked;
  }

  /** The user of the token, then the first reading, then the loop. Never throws. */
  async connect(generation) {
    const client = this.client;
    if (!client || generation !== this.generation) return;
    try {
      this.user = await client.currentUser();
      if (generation !== this.generation) return;
      await this.refresh({ publish: true });
      if (generation !== this.generation) return;
      this.logger.info(`NetBird answers: ${this.peers.size} peer(s) followed`);
    } catch (err) {
      await this.failed(err, generation);
      return;
    }
    this.scheduleLoop(this.pollMs(), generation);
  }

  async loop(generation, epoch) {
    if (!this.current(generation, epoch)) return;
    if (this.reading) {
      // A Discovery reading is in flight: it is this round's (its failure
      // takes its own path).
      await this.reading.catch(() => {});
      if (this.current(generation, epoch)) this.scheduleLoop(this.pollMs(), generation);
      return;
    }
    try {
      await this.refresh({ publish: false });
    } catch (err) {
      if (this.current(generation, epoch)) await this.failed(err, generation);
      return;
    }
    if (this.current(generation, epoch)) this.scheduleLoop(this.pollMs(), generation);
  }

  /** A reading failed: final refusal, a pause, or a retry with a growing delay. */
  async failed(err, generation) {
    if (generation !== this.generation) return;
    const wasOnline = this.online;
    this.online = false;
    // After an outage, the first reading is a new start: no event.
    this.baseline = false;
    this.halt();
    await this.publishTransports();
    if (isTokenRefused(err)) {
      this.blocked = true;
      await this.store.set('refusals', this.config.server.base, await this.refusalKey(this.config));
      this.logger.warn(
        `Access token refused by NetBird (HTTP ${err.status}): not retried until the configuration is saved`,
      );
      await this.setStatus(false, T.status.tokenRefused);
      return;
    }
    let delay = this.retryDelay;
    let pause = false;
    if (err.status === 429) {
      // Too many requests: a bounded pause of every path.
      delay = clamp(
        err.retryAfterMs ?? INTERVALS.BUSY_MIN_MS,
        Math.max(INTERVALS.BUSY_MIN_MS, this.pollMs()),
        INTERVALS.BUSY_MAX_MS,
      );
      pause = true;
    } else {
      if (err.status >= 500) {
        delay = clamp(err.retryAfterMs ?? delay, delay, INTERVALS.BUSY_MAX_MS);
        pause = true;
      }
      this.retryDelay = Math.min(this.retryDelay * 2, INTERVALS.RETRY_MAX_MS);
    }
    if (pause) {
      this.pausedUntil = this.now() + delay;
      await this.store.set('meta', this.pauseKey(), String(this.pausedUntil));
    }
    if (wasOnline || delay === this.minRetry() || pause) {
      this.logger.warn(`NetBird fails: ${err.message}`);
    }
    const message = this.errorMessage(err, delay);
    this.retryWait = {
      key: await this.refusalKey(this.config),
      at: this.now() + delay,
      delay: this.retryDelay,
      message,
    };
    if (generation !== this.generation) return;
    await this.setStatus(false, message);
    this.schedule(delay, () => this.connect(generation));
  }

  errorMessage(err, delay) {
    if (err.code === CODES.TLS_UNTRUSTED) return T.status.tlsUntrusted(delay);
    if (err.code === CODES.TLS_CHANGED) return T.status.tlsChanged(delay);
    if (err.status === 429) return T.status.busy(delay);
    if (err.status >= 500) return T.status.serverError(err.status, delay);
    if (err.status === 403) return T.status.forbidden(delay);
    if (err.code === CODES.BAD_ANSWER || err.code === CODES.HTTP) {
      return T.status.notNetbird(delay);
    }
    return T.status.unreachable(err, delay);
  }

  paused() {
    return this.now() < this.pausedUntil;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    await this.gladys.setConnectionStatus(connected, message).catch((err) => {
      this.lastStatus = null;
      this.logger.warn(`Connection status not sent: ${err.message}`);
    });
  }

  // --- Reading -----------------------------------------------------------------

  /**
   * Read the peers (and, once an hour, the account settings), publish them.
   * Throws when the peers cannot be read. The account settings are
   * secondary: their failure never blocks the peers (a 429 there pauses
   * everything once the peers are published).
   */
  refresh(options) {
    const reading = this.read(options).finally(() => {
      if (this.reading === reading) this.reading = null;
    });
    this.reading = reading;
    return reading;
  }

  async read({ publish }) {
    const client = this.client;
    if (!client) return;
    const { peers: all } = await client.peers();
    if (client !== this.client) return;
    // A pause asked earlier is over (the reading worked): forget it.
    if (this.store.get('meta', this.pauseKey())) {
      await this.store.set('meta', this.pauseKey(), null);
    }
    this.pausedUntil = 0;

    let busy = null;
    if (this.accountAt === null || this.now() - this.accountAt >= INTERVALS.ACCOUNT_MS) {
      try {
        const account = await client.account();
        if (account) this.account = account;
      } catch (err) {
        if (err?.status === 429) busy = err;
        // A token that may not read the account (a regular user): the
        // expiry dates stay unknown, the rest works.
        else this.logger.debug(`Account settings not read: ${err.message}`);
      }
      if (client !== this.client) return;
      this.accountAt = this.now();
    }

    const matching = all.filter((peer) => matchesFilter(this.config.filter, peer));
    const followed = matching.slice(0, LIMITS.PEERS);
    const events = [];
    if (this.baseline) {
      for (const peer of followed) {
        const was = this.peers.get(peer.id);
        if (!was) continue; // a new peer fires nothing
        if (was.connected === false && peer.connected === true) {
          events.push([SCENE_TRIGGERS.PEER_CONNECTED, peer]);
        }
        if (was.connected === true && peer.connected === false) {
          events.push([SCENE_TRIGGERS.PEER_DISCONNECTED, peer]);
        }
        if (was.loginExpired === false && peer.loginExpired === true) {
          events.push([SCENE_TRIGGERS.LOGIN_EXPIRED, peer]);
        }
      }
    }
    this.peers = new Map(followed.map((peer) => [peer.id, peer]));
    this.capped = matching.length - followed.length;
    this.counts = {
      total: matching.length,
      connected: matching.filter((peer) => peer.connected === true).length,
    };
    this.baseline = true;
    this.online = true;
    this.retryDelay = this.minRetry();
    this.retryWait = null;
    this.known = { key: this.knownKey(this.config), peers: followed };

    const discoveredKey = JSON.stringify(followed.map((peer) => [peer.id, peer.name]));
    if (publish || discoveredKey !== this.discoveredKey) await this.publishDiscovered();
    this.discoveredKey = discoveredKey;
    await this.publishPeerStates();
    await this.publishTransports();
    for (const [key, peer] of events.slice(0, LIMITS.EVENTS_PER_ROUND)) await this.fire(key, peer);
    if (events.length > LIMITS.EVENTS_PER_ROUND) {
      this.logger.warn(`${events.length - LIMITS.EVENTS_PER_ROUND} peer event(s) not sent`);
    }
    await this.setStatus(true, this.okMessage());
    if (busy) throw busy;
  }

  okMessage() {
    const filtered = Boolean(this.config.filter);
    const ownPeersOnly = this.user?.ownPeersOnly === true;
    if (!this.counts || this.counts.total === 0) {
      return T.status.noPeer({ filtered, ownPeersOnly });
    }
    return T.status.ok({
      ...this.counts,
      ownPeersOnly,
      capped: this.capped,
      filtered,
    });
  }

  async fire(key, peer) {
    await this.gladys
      .publishSceneEvent(key, {
        device: peerIds(this.gladys, peer.id).device,
        peer_name: peer.name,
        ip: peer.ip ?? '',
      })
      .catch((err) => {
        this.logger.warn(`Scene event not sent: ${err.message}`);
      });
  }

  /** Never throws: a refusal of Gladys is not a NetBird failure. */
  async publishDiscovered() {
    const devices = [buildNetworkDevice(this.gladys)];
    for (const peer of this.peers.values()) devices.push(buildPeerDevice(this.gladys, peer));
    await this.gladys.publishDiscoveredDevices(devices).catch((err) => {
      this.logger.warn(`Discovery not published: ${err.message}`);
    });
  }

  /** Discovery (scan button): read again when connected, else what is known. */
  async publishDiscovery() {
    if (this.reading) {
      // A reading is in flight: no second request, publish what it brings.
      await this.reading.catch(() => {});
      await this.publishDiscovered();
      return;
    }
    if (this.online && !this.paused() && this.client) {
      const generation = this.generation;
      const done = await this.refresh({ publish: true }).then(
        () => true,
        async (err) => {
          if (generation !== this.generation) return true;
          // Any failure takes the usual path (refusal, pause, retry).
          await this.failed(err, generation);
          return false;
        },
      );
      if (done) return;
    }
    if (this.peers.size === 0 && this.known) {
      for (const peer of this.known.peers) this.peers.set(peer.id, peer);
    }
    await this.publishDiscovered();
  }

  /**
   * The states of the created devices, in four groups by priority: the
   * counts, connected, login expired, the texts (last seen, IP, version,
   * expiry). A created peer missing from the reading (deleted in NetBird,
   * out of the filter) gets nothing.
   */
  statesOf() {
    const created = createdDevices(this.gladys);
    const counts = [];
    const connected = [];
    const expired = [];
    const texts = [];
    for (const { peerId } of created.peers) {
      const peer = this.peers.get(peerId);
      if (!peer) continue;
      const ids = peerIds(this.gladys, peerId);
      if (peer.connected !== null) {
        connected.push({
          device_feature_external_id: ids.feature(FEATURES.CONNECTED),
          state: peer.connected ? 1 : 0,
        });
      }
      if (peer.loginExpired !== null) {
        expired.push({
          device_feature_external_id: ids.feature(FEATURES.LOGIN_EXPIRED),
          state: peer.loginExpired ? 1 : 0,
        });
      }
      const values = [
        [FEATURES.LAST_SEEN, formatDate(peer.lastSeen)],
        [FEATURES.IP, peer.ip],
        [FEATURES.VERSION, peer.version],
        [FEATURES.LOGIN_EXPIRES, loginExpiry(peer, this.account)],
      ];
      for (const [key, value] of values) {
        if (value) texts.push({ device_feature_external_id: ids.feature(key), text: value });
      }
    }
    if (created.network && this.counts) {
      const ids = networkIds(this.gladys);
      counts.push(
        {
          device_feature_external_id: ids.feature(FEATURES.CONNECTED_COUNT),
          state: this.counts.connected,
        },
        { device_feature_external_id: ids.feature(FEATURES.TOTAL_COUNT), state: this.counts.total },
      );
    }
    return { counts, connected, expired, texts };
  }

  /**
   * Publish what changed, every state within the minute budget (POST /state
   * admits 300 per minute; this integration stays under 250): the counts
   * first, then connected, then login expired, then the texts, which take
   * turns when they are cut. What is held back goes at a later reading.
   */
  async publishPeerStates() {
    const { counts, connected, expired, texts } = this.statesOf();
    const changed = (list) =>
      list.filter((s) => this.published.get(s.device_feature_external_id) !== valueOf(s));
    let room = this.budget.remaining();
    const list = [];
    let held = 0;
    for (const group of [counts, connected, expired]) {
      const fresh = changed(group);
      list.push(...fresh.slice(0, room));
      held += Math.max(0, fresh.length - room);
      room = Math.max(0, room - fresh.length);
    }
    const freshTexts = changed(texts);
    if (freshTexts.length <= room) {
      list.push(...freshTexts);
    } else {
      const start = freshTexts.length > 0 ? this.textCursor % freshTexts.length : 0;
      for (let i = 0; i < room; i += 1) list.push(freshTexts[(start + i) % freshTexts.length]);
      this.textCursor = start + room;
      held += freshTexts.length - room;
    }
    if (held > 0) this.logger.debug(`${held} state(s) held back (state budget)`);
    if (list.length === 0) return;
    try {
      const result = await this.gladys.publishChangedStates(list);
      this.budget.record(result?.count ?? list.length);
      for (const s of list) this.published.set(s.device_feature_external_id, valueOf(s));
    } catch (err) {
      // Gladys may have counted them anyway: the budget does too.
      this.budget.record(list.length);
      this.logger.warn(`States not published: ${err.message}`);
    }
  }

  /** Forget what was published for a device (Gladys forgot it too). */
  forget(externalId) {
    if (typeof externalId !== 'string') return;
    const prefix = `${externalId}:`;
    for (const id of [...this.published.keys()]) {
      if (id === externalId || id.startsWith(prefix)) this.published.delete(id);
    }
  }

  async publishTransports() {
    const entries = [];
    const created = createdDevices(this.gladys);
    for (const { peerId, externalId } of created.peers) {
      const reachable = this.online && this.peers.has(peerId);
      entries.push({ external_id: externalId, transport: reachable ? 'cloud' : 'unreachable' });
    }
    if (created.network) {
      entries.push({
        external_id: created.network.externalId,
        transport: this.online ? 'cloud' : 'unreachable',
      });
    }
    const changed = entries.filter((e) => this.transports.get(e.external_id) !== e.transport);
    for (let start = 0; start < changed.length; start += TRANSPORTS_PER_CALL) {
      const batch = changed.slice(start, start + TRANSPORTS_PER_CALL);
      for (const entry of batch) this.transports.set(entry.external_id, entry.transport);
      await this.gladys.publishTransports(batch).catch((err) => {
        for (const entry of batch) this.transports.delete(entry.external_id);
        this.logger.debug(`Transports not published: ${err.message}`);
      });
    }
  }

  // --- Devices created / deleted in Gladys -----------------------------------

  /** Created or updated: the SDK forgot the values of this device, so do we. */
  async deviceCreated(device) {
    this.forget(device?.external_id);
    this.transports.delete(device?.external_id);
    if (this.online) await this.publishPeerStates();
    await this.publishTransports();
  }

  async deviceUpdated(device) {
    await this.deviceCreated(device);
  }

  deviceDeleted(device) {
    this.forget(device?.external_id);
    this.transports.delete(device?.external_id);
  }

  /** Read only in v1: no command reaches NetBird. */
  async setValue() {
    throw new Error(T.errors.readOnly);
  }

  // --- Configuration button --------------------------------------------------

  /** Resolves `promise`, or rejects with `message` after `ms`. */
  within(promise, ms, message) {
    let handle;
    const limit = new Promise((_, reject) => {
      handle = this.timers.setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, limit]).finally(() => this.timers.clearTimeout(handle));
  }

  /**
   * Reconnects, then reports, within 25 s. A refused token is not tried
   * again (only saving the configuration does), nor is a pause shortened.
   */
  async testConnection() {
    await this.within(
      this.start(this.rawConfig, { immediate: true }),
      TEST_BUDGET_MS,
      T.errors.testTooLong,
    );
    if (!this.online) {
      const message = this.lastStatus ? JSON.parse(this.lastStatus)[1] : null;
      throw new Error(message?.en ?? T.errors.notConnected);
    }
    return T.test.ok(this.counts ?? { total: 0, connected: 0 });
  }
}
