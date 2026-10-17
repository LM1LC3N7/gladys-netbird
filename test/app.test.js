// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and the fake NetBird, through
// the exact wiring of the container (src/handlers.js).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { NetbirdApp } from '../src/app.js';
import { ACTIONS, INTERVALS, LIMITS, SCENE_TRIGGERS } from '../src/constants.js';
import { buildNetworkDevice, buildPeerDevice } from '../src/devices.js';
import { registerHandlers } from '../src/handlers.js';
import { TOKEN, createFakeNetbird, netbirdPeer } from './helpers/fakeNetbird.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const T0 = Date.parse('2026-10-17T08:00:00Z');
const SELECTOR = 'netbird';
const ids = createFakeGladys({ selector: SELECTOR });
const NAS = 'cq1aaaaaaaaaaaaaaaa0';
const LAPTOP = 'cq1aaaaaaaaaaaaaaaa1';
const PHONE = 'cq1aaaaaaaaaaaaaaaa2';
const peerDevice = (id, name = id) => buildPeerDevice(ids, { id, name });
const featureId = (id, key) => `ext:${SELECTOR}:peer:${id}:${key}`;
const BASE_CONFIG = { token: TOKEN };

let running;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function setup({
  config = {},
  created = [NAS, LAPTOP, PHONE],
  network = true,
  netbird,
  dataDir,
  extraDevices = [],
  now = T0,
} = {}) {
  const clock = { now };
  netbird ??= createFakeNetbird();
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { ...BASE_CONFIG, ...config },
    devices: [
      ...created.map((id) => peerDevice(id)),
      ...(network ? [buildNetworkDevice(ids)] : []),
      ...extraDevices,
    ],
  });
  const timers = createFakeTimers();
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.stack ?? String(a)).join(' ')}`),
    ]),
  );
  const app = new NetbirdApp({
    gladys,
    logger,
    request: netbird.request,
    dataDir: dataDir ?? mkdtempSync(join(tmpdir(), 'nb-app-')),
    now: () => clock.now,
    timers,
  });
  running = app;
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  return { gladys, netbird, timers, clock, logs, app };
}

const poll = (timers, ms = 60_000) => timers.run((delay) => delay === ms);
const last = (gladys, id, key) => gladys.fake.lastState(featureId(id, key));
const peer = (netbird, id) => netbird.peers.find((p) => p.id === id);
/** Emit `connected` again (Gladys came back) and wait for the restart. */
async function reconnect(gladys, app) {
  gladys.emit('connected');
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  await app.queue;
}

test('start: status, Discovery, states, texts, counts, badges; read every 60 s', async () => {
  const { gladys, netbird, timers } = await setup();
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'NetBird answers: 2 of 3 peers connected.',
      fr: 'NetBird répond : 2 pairs connectés sur 3.',
    },
  });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name]),
    [
      [`ext:${SELECTOR}:network:main`, 'NetBird network'],
      [`ext:${SELECTOR}:peer:${NAS}`, 'NAS'],
      [`ext:${SELECTOR}:peer:${LAPTOP}`, 'Laptop'],
      [`ext:${SELECTOR}:peer:${PHONE}`, 'Phone'],
    ],
  );
  assert.equal(last(gladys, NAS, 'connected'), 1);
  assert.equal(last(gladys, LAPTOP, 'connected'), 0);
  assert.equal(last(gladys, NAS, 'last_seen'), '2026-10-17 07:59 UTC');
  assert.equal(last(gladys, NAS, 'ip'), '100.92.10.1');
  assert.equal(last(gladys, PHONE, 'version'), '0.58.0');
  assert.equal(last(gladys, NAS, 'login_expired'), 0);
  // Laptop: SSO peer, last login 2026-10-16 20:00 + 24 h of the account.
  assert.equal(last(gladys, LAPTOP, 'login_expires'), '2026-10-17 20:00 UTC');
  assert.equal(last(gladys, NAS, 'login_expires'), '—', 'a setup-key peer never expires');
  assert.equal(gladys.fake.lastState(`ext:${SELECTOR}:network:main:connected_count`), 2);
  assert.equal(gladys.fake.lastState(`ext:${SELECTOR}:network:main:total_count`), 3);
  assert.equal(gladys.fake.transports.length, 4);
  assert.ok(gladys.fake.transports.every((t) => t.transport === 'cloud'));
  assert.deepEqual(timers.delays(), [60_000]);
  assert.deepEqual(
    netbird.requests.map((r) => r.path),
    ['/api/users/current', '/api/peers', '/api/accounts'],
  );
  for (const request of netbird.requests) {
    assert.equal(request.headers.authorization, `Token ${TOKEN}`);
    assert.ok(!request.url.includes(TOKEN), 'never in the URL');
    assert.match(request.url, /^https:\/\/api\.netbird\.io\/api\//, 'NetBird Cloud by default');
  }
  await poll(timers);
  assert.equal(netbird.requests.filter((r) => r.path === '/api/accounts').length, 1, 'hourly');
  assert.deepEqual(timers.delays(), [60_000]);
});

test('no public IP, no e-mail, no location ever reaches Gladys', async () => {
  const { gladys } = await setup();
  const sent = JSON.stringify([gladys.fake.states, gladys.fake.discoveredDevices]);
  for (const secret of ['203.0.113.7', 'gladys@example.org', 'Paris', 'google-oauth2']) {
    assert.ok(!sent.includes(secret), secret);
  }
});

test('triggers: connected, disconnected, login expired; once; never at the first reading', async () => {
  const { gladys, netbird, timers } = await setup();
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the first reading fires nothing');
  peer(netbird, NAS).connected = false;
  peer(netbird, LAPTOP).connected = true;
  peer(netbird, PHONE).login_expired = true;
  peer(netbird, PHONE).connected = false;
  await poll(timers);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data]),
    [
      [
        SCENE_TRIGGERS.PEER_DISCONNECTED,
        { device: `ext:${SELECTOR}:peer:${NAS}`, peer_name: 'NAS', ip: '100.92.10.1' },
      ],
      [
        SCENE_TRIGGERS.PEER_CONNECTED,
        { device: `ext:${SELECTOR}:peer:${LAPTOP}`, peer_name: 'Laptop', ip: '100.92.10.2' },
      ],
      [
        SCENE_TRIGGERS.PEER_DISCONNECTED,
        { device: `ext:${SELECTOR}:peer:${PHONE}`, peer_name: 'Phone', ip: '100.92.10.3' },
      ],
      [
        SCENE_TRIGGERS.LOGIN_EXPIRED,
        { device: `ext:${SELECTOR}:peer:${PHONE}`, peer_name: 'Phone', ip: '100.92.10.3' },
      ],
    ],
  );
  assert.equal(last(gladys, PHONE, 'login_expired'), 1);
  await poll(timers);
  assert.equal(gladys.fake.sceneEvents.length, 4, 'no repeat while it stays so');
  // A new peer fires nothing.
  netbird.peers.push(netbirdPeer('cq1aaaaaaaaaaaaaaaa3', 'Tablet'));
  await poll(timers);
  assert.equal(gladys.fake.sceneEvents.length, 4);
});

test('after an outage, the first reading fires nothing', async () => {
  const { gladys, netbird, timers } = await setup();
  netbird.unreachable = true;
  await poll(timers);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  netbird.unreachable = false;
  peer(netbird, NAS).connected = false;
  await timers.run();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.sceneEvents.length, 0);
  assert.equal(last(gladys, NAS, 'connected'), 0, 'the state follows');
  peer(netbird, NAS).connected = true;
  await poll(timers);
  assert.equal(gladys.fake.sceneEvents.length, 1, 'then the changes fire again');
});

test('the external id is the NetBird id: a renamed peer with a new IP keeps its device', async () => {
  const { gladys, netbird, timers } = await setup();
  peer(netbird, NAS).name = 'Storage';
  peer(netbird, NAS).ip = '100.92.10.9';
  await poll(timers);
  const nas = gladys.fake.discoveredDevices.find((d) => d.external_id.endsWith(NAS));
  assert.equal(nas.name, 'Storage', 'Discovery published again on a change of name');
  assert.equal(last(gladys, NAS, 'ip'), '100.92.10.9');
});

test('the group filter: only its peers, counted alone', async () => {
  const { gladys } = await setup({ config: { groups: 'servers' } });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['NetBird network', 'NAS'],
  );
  assert.equal(gladys.fake.lastState(`ext:${SELECTOR}:network:main:total_count`), 1);
  assert.match(gladys.fake.connectionStatus.message.en, /1 of 1 peer connected \(groups/);
  assert.equal(last(gladys, LAPTOP, 'connected'), undefined, 'out of the filter: nothing');
  assert.ok(
    gladys.fake.transports.some(
      (t) => t.device_external_id.endsWith(LAPTOP) && t.transport === 'unreachable',
    ),
  );
  await running.stop();
  const none = await setup({ config: { groups: 'nothing-here' } });
  assert.match(none.gladys.fake.connectionStatus.message.en, /no peer is in the groups/);
});

test('a device published again never loses a feature of the created one', async () => {
  const created = peerDevice(NAS);
  created.features.push({
    name: 'Update available',
    external_id: featureId(NAS, 'update_available'),
    category: 'unknown',
    type: 'binary',
    read_only: true,
    min: 0,
    max: 1,
  });
  const { gladys } = await setup({ created: [], extraDevices: [created] });
  const nas = gladys.fake.discoveredDevices.find((d) => d.external_id.endsWith(NAS));
  assert.ok(nas.features.some((f) => f.external_id.endsWith(':update_available')));
  assert.equal(nas.features.length, created.features.length);
});

test('a refused token (401) stops everything, even across a restart; saving tries again', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'nb-app-'));
  const { gladys, netbird, timers, logs, app } = await setup({
    config: { token: 'nbp_wrong' },
    dataDir,
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the access token/);
  assert.equal(timers.pending.size, 0, 'no retry timer');
  assert.deepEqual(
    netbird.requests.map((r) => r.path),
    ['/api/users/current', '/api/peers'],
    'the peers decide, not the user',
  );
  assert.ok(gladys.fake.transports.every((t) => t.transport === 'unreachable'));
  // Gladys comes back: the status and the badges are sent again, nothing reaches NetBird.
  const statuses = gladys.fake.connectionStatuses.length;
  const badges = gladys.fake.transports.length;
  await reconnect(gladys, app);
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.transports.length, badges + 4);
  assert.equal(netbird.requests.length, 2);
  // The test button does not try again either.
  const ack = await gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, false);
  assert.match(ack.error, /refused the access token/);
  assert.equal(netbird.requests.length, 2);
  await running.stop();
  const second = await setup({ config: { token: 'nbp_wrong' }, dataDir, netbird });
  assert.equal(netbird.requests.length, 2, 'the restart sent nothing');
  await second.gladys.fake.configUpdated({ ...BASE_CONFIG, token: TOKEN });
  assert.equal(second.gladys.fake.connectionStatus.connected, true);
  assert.ok(![...logs, ...second.logs].some((l) => l.includes('nbp_wrong') || l.includes(TOKEN)));
});

test('403 answered by the API on /api/peers is a refusal; a 403 page of a proxy is not', async () => {
  const netbird = createFakeNetbird();
  netbird.failures.push({ path: '/api/peers', status: 403 });
  const { gladys, timers } = await setup({ netbird });
  assert.match(gladys.fake.connectionStatus.message.en, /refused the access token/);
  assert.equal(timers.pending.size, 0);
  await running.stop();

  const proxied = createFakeNetbird();
  proxied.failures.push({ path: '/api/peers', status: 403, body: '<html>Forbidden</html>' });
  const second = await setup({ netbird: proxied });
  assert.match(second.gladys.fake.connectionStatus.message.en, /in front of NetBird/);
  assert.deepEqual(second.timers.delays(), [INTERVALS.RETRY_MIN_MS]);
  await second.timers.run();
  assert.equal(second.gladys.fake.connectionStatus.connected, true);
});

test('the account settings are secondary: a 403 there leaves the peers working', async () => {
  const netbird = createFakeNetbird();
  netbird.failures.push({ path: '/api/accounts', status: 403 });
  const { gladys, timers } = await setup({ netbird });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(last(gladys, NAS, 'connected'), 1);
  assert.equal(last(gladys, LAPTOP, 'login_expires'), undefined, 'unknown: nothing published');
  assert.equal(last(gladys, NAS, 'login_expires'), '—', 'off for the peer itself');
  assert.deepEqual(timers.delays(), [60_000]);
});

test('an older server without /api/users/current still works', async () => {
  const netbird = createFakeNetbird();
  netbird.failures.push({ path: '/api/users/current', status: 404 });
  const { gladys } = await setup({ netbird });
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a service user token works: the 403 of /api/users/current is no refusal', async () => {
  const { gladys, netbird, app, timers } = await setup();
  assert.equal(netbird.requests[0].path, '/api/users/current');
  assert.equal(app.user, null);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(timers.delays(), [60_000]);
  // The same for a regular user that may not read it, and for a 401 there.
  for (const status of [403, 401]) {
    await running.stop();
    const other = createFakeNetbird();
    other.user.is_service_user = false;
    other.failures.push({ path: '/api/users/current', status });
    const next = await setup({ netbird: other });
    assert.equal(next.gladys.fake.connectionStatus.connected, true, String(status));
  }
});

test('/api/users/current answering 429 pauses like any reading', async () => {
  const netbird = createFakeNetbird();
  netbird.failures.push({ path: '/api/users/current', status: 429 });
  const { gladys, timers } = await setup({ netbird });
  assert.match(gladys.fake.connectionStatus.message.en, /slow down/);
  assert.deepEqual(timers.delays(), [INTERVALS.BUSY_MIN_MS]);
});

test('a User-role token lists only its own peers: said in the status, even with no peer', async () => {
  const netbird = createFakeNetbird();
  Object.assign(netbird.user, { is_service_user: false, role: 'user' });
  netbird.user.permissions = { is_restricted: false, modules: { peers: { read: false } } };
  const { gladys } = await setup({ netbird });
  assert.match(gladys.fake.connectionStatus.message.en, /lists only its own peers/);
  assert.match(gladys.fake.connectionStatus.message.en, /Auditor/);
  await running.stop();
  const restricted = createFakeNetbird();
  Object.assign(restricted.user, { is_service_user: false, role: 'user' });
  restricted.user.permissions.is_restricted = true;
  restricted.peers = [];
  const second = await setup({ netbird: restricted });
  assert.match(second.gladys.fake.connectionStatus.message.en, /sees no peer/);
  assert.match(second.gladys.fake.connectionStatus.message.en, /lists only its own peers/);
  await running.stop();
  // A service user (user unknown) with an empty list: the Auditor advice.
  const empty = createFakeNetbird();
  empty.peers = [];
  const third = await setup({ netbird: empty });
  assert.match(third.gladys.fake.connectionStatus.message.en, /Auditor role/);
  assert.match(third.gladys.fake.connectionStatus.message.fr, /0 pair connecté|aucun pair/);
});

test('French: 0 and 1 take the singular', async () => {
  const netbird = createFakeNetbird();
  for (const p of netbird.peers) p.connected = false;
  const { gladys } = await setup({ netbird });
  assert.match(gladys.fake.connectionStatus.message.fr, /0 pair connecté sur 3/);
});

test('HTTP 429: a bounded pause kept in /data across a restart, Gladys and a saved configuration', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'nb-app-'));
  const { gladys, netbird, timers, app } = await setup({ dataDir });
  netbird.failures.push({ path: '/api/peers', status: 429, headers: { 'retry-after': '120' } });
  await poll(timers);
  assert.match(gladys.fake.connectionStatus.message.en, /slow down/);
  assert.deepEqual(timers.delays(), [120_000]);
  assert.ok(gladys.fake.transports.some((t) => t.transport === 'unreachable'));
  const before = netbird.requests.length;
  // Gladys comes back during the pause: status and Discovery sent again, no request.
  const discoveries = gladys.fake.bodies('POST', '/discovered_device').length;
  await reconnect(gladys, app);
  assert.equal(netbird.requests.length, before);
  assert.match(gladys.fake.connectionStatus.message.en, /the pause goes on/);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
  assert.equal(gladys.fake.discoveredDevices.length, 4, 'from the peers known');
  // Saving the configuration does not shorten it.
  await gladys.fake.configUpdated({ ...BASE_CONFIG });
  assert.equal(netbird.requests.length, before);
  // Scan during the pause: what is known, no request.
  await gladys.fake.scanRequest();
  assert.equal(netbird.requests.length, before);
  await running.stop();
  await setup({ netbird, dataDir });
  assert.equal(netbird.requests.length, before, 'the restart waits for the end of the pause');
});

test('HTTP 429: never shorter than 1 min nor than the interval, never above 6 h', async () => {
  const { gladys, netbird, timers } = await setup({ config: { poll_interval: '300' } });
  netbird.failures.push({ path: '/api/peers', status: 429, headers: { 'retry-after': '1' } });
  await poll(timers, 300_000);
  assert.deepEqual(timers.delays(), [300_000]);
  await running.stop();
  const second = await setup();
  second.netbird.failures.push({
    path: '/api/peers',
    status: 429,
    headers: { 'retry-after': String(30 * 86_400) },
  });
  await poll(second.timers);
  assert.deepEqual(second.timers.delays(), [INTERVALS.BUSY_MAX_MS]);
  assert.ok(gladys);
});

test('a pause end written far in the future is capped when read back', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'nb-app-'));
  const { netbird, timers } = await setup({ dataDir });
  netbird.failures.push({ path: '/api/peers', status: 429 });
  await poll(timers);
  await running.stop();
  const file = join(dataDir, 'netbird.json');
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  const key = Object.keys(stored.meta).find((k) => k.startsWith('pausedUntil|'));
  stored.meta[key] = String(T0 + 365 * 86_400_000);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, JSON.stringify(stored));
  const second = await setup({ dataDir });
  assert.deepEqual(second.timers.delays(), [INTERVALS.BUSY_MAX_MS]);
  const rewritten = Number(JSON.parse(readFileSync(file, 'utf8')).meta[key]);
  assert.equal(rewritten, T0 + INTERVALS.BUSY_MAX_MS, 'the capped end is written back');
  // A second reading of the file, an hour later: the end does not move.
  await running.stop();
  const third = await setup({ dataDir, now: T0 + 3600_000 });
  assert.deepEqual(third.timers.delays(), [INTERVALS.BUSY_MAX_MS - 3600_000]);
  assert.equal(third.netbird.requests.length, 0);
});

test('a pause that ended is removed from /data after a reading that works', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'nb-app-'));
  const { gladys, netbird, timers } = await setup({ dataDir });
  netbird.failures.push({ path: '/api/peers', status: 429 });
  await poll(timers);
  assert.match(readFileSync(join(dataDir, 'netbird.json'), 'utf8'), /pausedUntil/);
  await timers.run();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.doesNotMatch(readFileSync(join(dataDir, 'netbird.json'), 'utf8'), /pausedUntil/);
});

test('HTTP 5xx: a pause kept in /data, then doubling', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'nb-app-'));
  const { gladys, netbird, timers } = await setup({ dataDir });
  netbird.failures.push(
    { path: '/api/peers', status: 503 },
    { path: '/api/users/current', status: 502 },
  );
  await poll(timers);
  assert.match(gladys.fake.connectionStatus.message.en, /server error \(HTTP 503\)/);
  assert.deepEqual(timers.delays(), [60_000]);
  await timers.run();
  assert.match(gladys.fake.connectionStatus.message.en, /HTTP 502/);
  assert.deepEqual(timers.delays(), [120_000]);
  const content = readFileSync(join(dataDir, 'netbird.json'), 'utf8');
  assert.match(content, /pausedUntil\|https:\/\/api\.netbird\.io/);
  await timers.run();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('NetBird unreachable: retried, never faster than the interval, never dead', async () => {
  const { gladys, netbird, timers } = await setup({ config: { poll_interval: '120' } });
  netbird.unreachable = true;
  await poll(timers, 120_000);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer: no connection/);
  assert.deepEqual(timers.delays(), [120_000]);
  await timers.run();
  assert.deepEqual(timers.delays(), [240_000]);
  for (let i = 0; i < 10; i += 1) await timers.run();
  assert.deepEqual(timers.delays(), [INTERVALS.RETRY_MAX_MS], 'capped, still scheduled');
  netbird.unreachable = false;
  await timers.run();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(timers.delays(), [120_000]);
});

test('a reconnection to Gladys keeps the retry wait; the button reads at once', async () => {
  const { gladys, netbird, timers, app } = await setup();
  netbird.unreachable = true;
  await poll(timers);
  await timers.run(); // second failure: next wait 120 s
  assert.deepEqual(timers.delays(), [120_000]);
  const before = netbird.requests.length;
  await reconnect(gladys, app);
  assert.equal(netbird.requests.length, before, 'the wait is not skipped');
  assert.deepEqual(timers.delays(), [120_000]);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer/);
  assert.equal(gladys.fake.discoveredDevices.length, 4, 'Discovery from the peers known');
  netbird.unreachable = false;
  const ack = await gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, true, ack.error);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('read only: every command is refused, nothing reaches NetBird', async () => {
  const { gladys, netbird } = await setup();
  const nas = peerDevice(NAS);
  const before = netbird.requests.length;
  for (const feature of nas.features) {
    const ack = await gladys.fake.setValue(nas, feature, 0);
    assert.equal(ack.success, false);
    assert.match(ack.error, /only reads NetBird/);
  }
  assert.equal(netbird.requests.length, before);
  assert.ok(nas.features.every((f) => f.read_only === true && f.category !== 'switch'));
});

test('the test button reads again and reports', async () => {
  const { gladys } = await setup();
  const ack = await gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.message.en, /Connected: 2 of 3 peers connected/);
});

test('the status and Discovery are sent again at every connection to Gladys', async () => {
  const { gladys, app } = await setup();
  const statuses = gladys.fake.connectionStatuses.length;
  const discoveries = gladys.fake.bodies('POST', '/discovered_device').length;
  await reconnect(gladys, app);
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
});

test('the configuration is checked before anything is sent', async () => {
  for (const [config, pattern] of [
    [{ url: 'http://netbird.example.org' }, /in clear/],
    [{ url: 'https://user:pw@netbird.example.org' }, /user name and password/],
    [{ url: 'https://netbird.example.org/?x=1' }, /not valid/],
    [{ token: '' }, /personal access token/],
    [{ token: 'nbp_abc​def' }, /invisible character/],
    [{ certificate_fingerprint: 'AB:CD' }, /SHA-256 fingerprint/],
  ]) {
    const { gladys, netbird } = await setup({ config });
    assert.match(gladys.fake.connectionStatus.message.en, pattern);
    assert.equal(netbird.requests.length, 0);
    await running.stop();
  }
});

test('a self-hosted server: its address, /api added once', async () => {
  const { netbird } = await setup({ config: { url: 'netbird.example.org:8443/api/' } });
  assert.equal(netbird.requests[0].url, 'https://netbird.example.org:8443/api/users/current');
});

test('every state is budgeted: the counts first, then connected, then the texts', async () => {
  const { gladys, netbird, timers, app, clock } = await setup();
  app.budget.record(app.budget.remaining() - 2);
  peer(netbird, NAS).version = '0.60.0';
  peer(netbird, NAS).connected = false;
  await poll(timers);
  assert.equal(gladys.fake.lastState(`ext:${SELECTOR}:network:main:connected_count`), 1);
  assert.equal(last(gladys, NAS, 'connected'), 0);
  assert.equal(last(gladys, NAS, 'version'), '0.59.1', 'held back');
  clock.now += 61_000;
  await poll(timers);
  assert.equal(last(gladys, NAS, 'version'), '0.60.0', 'sent once the window slid');
});

test('200 created peers: never more than 250 states in a minute, the texts in turn', async () => {
  const netbird = createFakeNetbird();
  const ids200 = Array.from({ length: 200 }, (_, i) => `p${String(i).padStart(4, '0')}`);
  netbird.peers = ids200.map((id, i) =>
    netbirdPeer(id, `Peer ${i}`, { ip: `100.92.${Math.floor(i / 250)}.${(i % 250) + 1}` }),
  );
  const { gladys, timers, clock } = await setup({ netbird, created: ids200 });
  const sent = [];
  const count = () => gladys.fake.states.length;
  sent.push([clock.now, count()]);
  assert.ok(count() <= LIMITS.STATES_PER_MINUTE, `${count()} states at start`);
  for (let round = 0; round < 8; round += 1) {
    // Readings every 20 s: the window holds three of them.
    clock.now += 20_000;
    await poll(timers);
    sent.push([clock.now, count()]);
  }
  for (const [at, total] of sent) {
    const before = sent.filter(([t]) => t <= at - 60_000).at(-1)?.[1] ?? 0;
    assert.ok(total - before <= LIMITS.STATES_PER_MINUTE, `${total - before} states in a minute`);
  }
  // Everything arrives in the end: every text of every peer.
  for (let round = 0; round < 10; round += 1) {
    clock.now += 61_000;
    await poll(timers);
  }
  for (const id of ids200) {
    assert.ok(last(gladys, id, 'ip'), id);
    assert.ok(last(gladys, id, 'last_seen'), id);
  }
});

test('one reading at a time: Discovery during a reading sends no second request', async () => {
  const { gladys, netbird, timers } = await setup();
  let release;
  netbird.peersGate = new Promise((resolve) => (release = resolve));
  const looping = poll(timers);
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  const scan = gladys.fake.scanRequest();
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  netbird.peersGate = null;
  release();
  await looping;
  await scan;
  assert.equal(netbird.requests.filter((r) => r.path === '/api/peers').length, 2, 'start + one');
  assert.deepEqual(timers.delays(), [60_000]);
});

test('a device updated in Gladys gets its values again', async () => {
  const { gladys, app } = await setup();
  const before = gladys.fake.states.length;
  await gladys.fake.deviceUpdated(peerDevice(NAS));
  const resent = gladys.fake.states.slice(before).map((s) => s.device_feature_external_id);
  assert.ok(resent.length > 0 && resent.every((id) => id.includes(`:${NAS}:`)), 'only NAS');
  assert.ok(
    [...app.published.keys()].some((id) => id.includes(LAPTOP)),
    'the others kept',
  );
});

test('a device created later gets its states and badge at once', async () => {
  const { gladys } = await setup({ created: [], network: false });
  assert.equal(last(gladys, NAS, 'connected'), undefined);
  const nas = gladys.fake.discoveredDevices.find((d) => d.external_id.endsWith(NAS));
  await gladys.fake.deviceCreated(nas);
  assert.equal(last(gladys, NAS, 'connected'), 1);
  assert.equal(last(gladys, NAS, 'ip'), '100.92.10.1');
  assert.ok(gladys.fake.transports.some((t) => t.device_external_id.endsWith(NAS)));
});

test('the token is never written to /data', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'nb-app-'));
  await setup({ dataDir, config: { token: 'nbp_wrong_secret' } });
  assert.deepEqual(readdirSync(dataDir), ['netbird.json']);
  const content = readFileSync(join(dataDir, 'netbird.json'), 'utf8');
  assert.match(content, /refusals/);
  assert.ok(!content.includes('nbp_wrong_secret'));
  assert.ok(!content.includes(TOKEN));
});

test('500 peers at most; the rest is said in the status', async () => {
  const netbird = createFakeNetbird();
  netbird.peers = Array.from({ length: 520 }, (_, i) =>
    netbirdPeer(`p${String(i).padStart(4, '0')}`, `Peer ${i}`),
  );
  const { gladys } = await setup({ netbird, created: [] });
  assert.equal(gladys.fake.discoveredDevices.length, LIMITS.PEERS + 1);
  assert.match(gladys.fake.connectionStatus.message.en, /20 more peers are left out/);
  assert.equal(gladys.fake.lastState(`ext:${SELECTOR}:network:main:total_count`), 520);
});
