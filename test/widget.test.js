// -----------------------------------------------------------------------------
// The "peers" dashboard widget: the pure content (every filter, sort, budget,
// limits of the SDK, pages, errors, no secret), then the app (from the last
// reading, no request of its own, refresh nudges).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { NetbirdApp } from '../src/app.js';
import { WIDGETS } from '../src/constants.js';
import { buildNetworkDevice, buildPeerDevice } from '../src/devices.js';
import { registerHandlers } from '../src/handlers.js';
import { parsePeers } from '../src/netbird/parse.js';
import { WIDGET_LIMITS, cut, instantOf, peersWidget, sortPeers } from '../src/widget.js';
import { TOKEN, createFakeNetbird, netbirdPeer } from './helpers/fakeNetbird.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const SELECTOR = 'netbird';
const gladys = createFakeGladys({ selector: SELECTOR });
const T0 = Date.parse('2026-10-17T08:00:00Z');
const deviceOf = (id) => `ext:${SELECTOR}:peer:${id}`;

/** Peers as the app holds them (through the parser of the API). */
function peers(list) {
  return parsePeers(list.map(([id, name, options]) => netbirdPeer(id, name, options))).peers;
}

const SAMPLE = peers([
  ['p0', 'nas', { ip: '100.92.0.1', groups: [{ id: 'g1', name: 'Servers' }] }],
  ['p1', 'Laptop', { ip: '100.92.0.2', connected: false, last_seen: '2026-10-16T21:30:00Z' }],
  ['p2', 'Phone', { ip: '100.92.0.3', connected: false, last_seen: '2026-10-17T06:00:00Z' }],
  ['p3', 'Desktop', { ip: '100.92.0.4' }],
  [
    'p4',
    'Old tablet',
    { ip: '100.92.0.5', connected: false, last_seen: '2026-09-01T10:00:00Z', login_expired: true },
  ],
]);

const build = (overrides = {}) =>
  peersWidget({
    state: 'ok',
    peers: SAMPLE,
    readAt: T0,
    settings: {},
    language: 'en',
    gladys,
    ttlSeconds: 60,
    ...overrides,
  });

const of = (content, type) => content.components.filter((c) => c.type === type);
const list = (content) => of(content, 'card-list')[0];
const tiles = (content) =>
  Object.fromEntries(of(content, 'value').map((c) => [c.label, [c.value, c.color]]));

/** The content budget and the text limits of the SDK README ("Dashboard widgets"). */
function assertWithinSdk(content) {
  assert.deepEqual(validateWidgetContent(content), [], 'rendered exactly as sent');
  assert.ok(content.ttl_seconds >= 10 && content.ttl_seconds <= 3600);
  const c = content.components;
  const count = (types) => c.filter((x) => types.includes(x.type)).length;
  assert.ok(c.length <= 8, `${c.length} components`);
  assert.ok(count(['chart', 'card-list', 'image']) <= 1, 'one focal');
  assert.ok(count(['value', 'gauge']) <= 6, 'six tiles');
  assert.ok(count(['status']) <= 1, 'one status');
  assert.ok(count(['text']) <= 2, 'two texts');
  assert.ok(c.filter((x) => x.type === 'text' && x.variant === 'body').length <= 1, 'one body');
  for (const x of c) {
    if (x.type === 'text') {
      const max = { heading: 40, body: 300, caption: 80 }[x.variant];
      assert.ok(x.text.length <= max, `${x.variant}: ${x.text}`);
    }
    if (x.type === 'value') {
      assert.ok(x.label.length <= 24, x.label);
      assert.ok(typeof x.value === 'number' || x.value.length <= 12);
    }
    if (x.type === 'status') {
      assert.ok(x.items.length >= 1 && x.items.length <= 10);
      for (const item of x.items) {
        assert.ok(item.label.length <= 40, item.label);
        assert.ok(String(item.value).length <= 40, item.value);
      }
    }
    if (x.type === 'card-list') {
      assert.equal(x.display, 'list');
      assert.ok(x.items.length >= 1 && x.items.length <= 8, `${x.items.length} items`);
      for (const item of x.items) {
        assert.ok(item.title.length <= 60);
        assert.ok(!item.subtitle || item.subtitle.length <= 60, item.subtitle);
        assert.ok(item.badge.text.length <= 16, item.badge.text);
        assert.ok(!item.description || item.description.length <= 2000);
        assert.equal(item.links, undefined, 'no link');
        if (item.date) assert.ok(!Number.isNaN(Date.parse(item.date)));
      }
    }
  }
}

test('filter "all": connected first by name, then disconnected, most recent first', () => {
  const content = build();
  assertWithinSdk(content);
  assert.deepEqual(
    list(content).items.map((i) => i.title),
    ['Desktop', 'nas', 'Phone', 'Laptop', 'Old tablet'],
  );
  const [desktop, , phone] = list(content).items;
  assert.deepEqual(desktop.badge, { text: 'online', color: 'success' });
  assert.equal(desktop.subtitle, '100.92.0.4 · desktop.netbird.cloud');
  assert.equal(desktop.date, undefined, 'no date for a connected peer');
  assert.deepEqual(phone.badge, { text: 'offline', color: 'neutral' });
  assert.equal(phone.date, '2026-10-17T06:00:00.000Z');
  // The last connection is the date of the row (time zone of the user), not
  // repeated in the details as UTC.
  assert.doesNotMatch(phone.description, /Last seen/);
  assert.match(phone.description, /^System: Debian GNU\/Linux 12$/m);
  assert.match(phone.description, /^NetBird version: 0\.59\.1$/m);
  assert.match(phone.description, /^Groups: All$/m);
  assert.match(phone.description, /^DNS name: phone\.netbird\.cloud$/m);
  const tablet = list(content).items[4];
  assert.deepEqual(tablet.badge, { text: 'login expired', color: 'warning' });
  assert.match(tablet.description, /netbird up/);
  assert.deepEqual(tiles(content), {
    Connected: [2, 'success'],
    Disconnected: [3, 'neutral'],
    Total: [5, 'primary'],
    'Login expired': [1, 'warning'],
  });
  const [status] = of(content, 'status');
  assert.deepEqual(
    status.items.map((i) => [i.label, i.value, i.color]),
    [
      ['NetBird', 'answers', 'success'],
      ['Last reading', '2026-10-17 08:00 UTC', 'neutral'],
    ],
  );
  assert.equal(of(content, 'text').length, 0, 'no caption: everything fits');
});

test('filter "connected" and "disconnected": the rows only, the counts unchanged', () => {
  const connected = build({ settings: { filter: 'connected' } });
  assertWithinSdk(connected);
  assert.deepEqual(
    list(connected).items.map((i) => i.title),
    ['Desktop', 'nas'],
  );
  const disconnected = build({ settings: { filter: 'disconnected' } });
  assertWithinSdk(disconnected);
  assert.deepEqual(
    list(disconnected).items.map((i) => i.title),
    ['Phone', 'Laptop', 'Old tablet'],
  );
  assert.deepEqual(tiles(connected), tiles(disconnected));
  assert.ok(list(disconnected).items.every((i) => i.date));
  // Nothing to list: a short text instead of an empty list (refused by the core).
  const none = build({
    peers: SAMPLE.filter((p) => p.connected),
    settings: { filter: 'disconnected' },
  });
  assertWithinSdk(none);
  assert.equal(list(none), undefined);
  assert.deepEqual(of(none, 'text')[0], {
    type: 'text',
    text: 'No peer disconnected.',
    variant: 'body',
  });
});

test('French texts', () => {
  const content = build({ language: 'fr-FR' });
  assertWithinSdk(content);
  assert.deepEqual(Object.keys(tiles(content)), [
    'Connectés',
    'Déconnectés',
    'Total',
    'Connexion expirée',
  ]);
  const items = list(content).items;
  assert.equal(items[0].badge.text, 'en ligne');
  assert.equal(items[2].badge.text, 'hors ligne');
  assert.equal(items[4].badge.text, 'conn. expirée');
  assert.match(items[4].description, /^Connexion expirée : reconnectez ce client/m);
  assert.match(items[2].description, /^Système : Debian GNU\/Linux 12$/m);
  assert.equal(of(content, 'status')[0].items[0].value, 'répond');
});

test('French vocabulary: "clients" and "connexion expirée", never "pair" nor "session"', async () => {
  const { T } = await import('../src/i18n.js');
  const texts = [];
  const walk = (node) => {
    if (typeof node === 'function') {
      walk(node(2, 3));
      walk(node(1, 1));
    } else if (node && typeof node === 'object') {
      if (typeof node.fr === 'string') texts.push(node.fr);
      for (const value of Object.values(node)) if (typeof value !== 'string') walk(value);
    }
  };
  walk(T.widget);
  assert.ok(texts.length > 30);
  assert.doesNotMatch(texts.join('\n'), /\bpairs?\b|session/i);
  const manifest = JSON.parse(
    readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
  );
  assert.doesNotMatch(JSON.stringify(manifest.widgets), /\bpairs?\b|session/i);
});

test('cut never splits a UTF-16 pair; dates at midnight UTC stay instants', () => {
  assert.equal(cut(`${'a'.repeat(38)}😀zz`, 40), `${'a'.repeat(38)}…`);
  assert.equal(cut(`${'a'.repeat(37)}😀zz`, 40), `${'a'.repeat(37)}😀…`);
  assert.doesNotMatch(cut(`${'a'.repeat(38)}😀zz`, 40), /[\ud800-\udbff](?![\udc00-\udfff])/);
  assert.equal(cut('short', 40), 'short');
  const midnight = Date.parse('2026-10-16T00:00:00Z');
  assert.equal(instantOf(midnight), '2026-10-16T00:00:00.001Z');
  assert.equal(instantOf(midnight + 60_000), '2026-10-16T00:01:00.000Z');
  const content = build({
    peers: peers([['a', 'Box', { connected: false, last_seen: '2026-10-16T00:00:00Z' }]]),
  });
  assert.doesNotMatch(list(content).items[0].date, /^(\d{4}-\d{2}-\d{2})(T00:00:00(\.000)?Z)?$/);
  assertWithinSdk(content);
});

test('sort: names without case, unknown last seen at the end, ties by name', () => {
  const sorted = sortPeers(
    peers([
      ['a', 'zed', { connected: false, last_seen: 'never' }],
      ['b', 'Alpha', { connected: false, last_seen: '2026-10-01T00:00:00Z' }],
      ['c', 'beta', {}],
      ['d', 'ALPHA', {}],
      ['e', 'Gamma', { connected: false, last_seen: '2026-10-01T00:00:00Z' }],
    ]),
  );
  assert.deepEqual(
    sorted.map((p) => p.name),
    ['ALPHA', 'beta', 'Alpha', 'Gamma', 'zed'],
  );
});

test('more than 8 peers: 8 rows (or fewer) and "+N more"; pages', () => {
  const many = peers(
    Array.from({ length: 20 }, (_, i) => [
      `p${String(i).padStart(2, '0')}`,
      `Peer ${String(i).padStart(2, '0')}`,
      { ip: `100.92.1.${i + 1}` },
    ]),
  );
  const first = build({ peers: many });
  assertWithinSdk(first);
  assert.equal(list(first).items.length, WIDGET_LIMITS.ITEMS);
  assert.deepEqual(of(first, 'text').at(-1), {
    type: 'text',
    text: '+12 more',
    variant: 'caption',
  });
  const three = build({ peers: many, settings: { max_items: '3', page: 2 } });
  assertWithinSdk(three);
  assert.deepEqual(
    list(three).items.map((i) => i.title),
    ['Peer 03', 'Peer 04', 'Peer 05'],
  );
  assert.equal(of(three, 'text').at(-1).text, 'Page 2 · +14 more');
  const lastPage = build({ peers: many, settings: { max_items: '8', page: 3 }, language: 'fr' });
  assertWithinSdk(lastPage);
  assert.equal(list(lastPage).items.length, 4);
  assert.equal(of(lastPage, 'text').at(-1).text, 'Page 3');
  const beyond = build({ peers: many, settings: { page: 9 } });
  assertWithinSdk(beyond);
  assert.equal(beyond.components[3].text, 'Page 9 is empty: 20 peers in this view.');
  // Odd settings (an older dashboard): the defaults.
  const odd = build({ peers: many, settings: { max_items: '50', page: -2, filter: 'x' } });
  assertWithinSdk(odd);
  assert.equal(list(odd).items.length, 8);
  assert.equal(of(build({ peers: many, language: 'fr' }), 'text').at(-1).text, '+12 autres');
});

test('groups and watched peers: the counts follow the groups, a watched peer offline is red', () => {
  const servers = build({ settings: { groups: 'servers' } });
  assertWithinSdk(servers);
  assert.deepEqual(
    list(servers).items.map((i) => i.title),
    ['nas'],
  );
  assert.equal(tiles(servers).Total[0], 1);
  const nobody = build({ settings: { groups: 'nothing' } });
  assertWithinSdk(nobody);
  assert.match(of(nobody, 'text')[0].text, /no peer is in this view/);
  assert.deepEqual(tiles(nobody).Total, [0, 'primary']);

  const watched = build({ settings: { watch: [deviceOf('p2'), deviceOf('p0'), 'bogus'] } });
  assertWithinSdk(watched);
  assert.deepEqual(tiles(watched).Disconnected, [3, 'danger']);
  const phone = list(watched).items.find((i) => i.title === 'Phone');
  assert.deepEqual(phone.badge, { text: 'offline', color: 'danger' });
  assert.deepEqual(
    of(watched, 'status')[0].items.at(-1),
    { label: 'Watched, offline', value: 'Phone', icon: 'alert-triangle', color: 'danger' },
    'the connected watched NAS is not named',
  );
});

test('errors: an empty state with a text, or the last peers with a red status', () => {
  // Nothing ever read (readAt null), or a state that never shows peers.
  for (const [state, readAt] of [
    ['refused', T0],
    ['config', T0],
    ['waiting', null],
    ['error', null],
    ['paused', null],
  ]) {
    const content = build({ state, readAt, peers: readAt === null ? [] : SAMPLE });
    assertWithinSdk(content);
    assert.equal(list(content), undefined, `${state}: no peer shown`);
    assert.equal(of(content, 'value').length, 0, `${state}: no count`);
    assert.equal(of(content, 'text')[0].variant, 'body');
    assert.ok(of(content, 'text')[0].text.length > 20);
  }
  assert.match(build({ state: 'refused' }).components[0].text, /refused the access token/);
  const stale = build({ state: 'error' });
  assertWithinSdk(stale);
  assert.equal(list(stale).items.length, 5, 'the last peers read, the IPs rarely change');
  assert.ok(of(stale, 'value').every((t) => t.color === 'danger'));
  assert.deepEqual(
    of(stale, 'status')[0].items.map((i) => [i.value, i.color]),
    [
      ['no answer', 'danger'],
      ['2026-10-17 08:00 UTC', 'danger'],
    ],
  );
  // During an outage, the badges tell what was last read: neutral.
  assert.ok(list(stale).items.every((i) => i.badge.color === 'neutral'));
  const paused = build({ state: 'paused' });
  assert.ok(of(paused, 'value').every((t) => t.color === 'warning'));
  assert.ok(list(paused).items.every((i) => i.badge.color === 'neutral'));
});

test('S13: NetBird answers with no peer: 0 / 0 / 0, a text, the last reading', () => {
  for (const settings of [{}, { filter: 'disconnected' }, { groups: 'servers' }]) {
    const content = build({ peers: [], settings });
    assertWithinSdk(content);
    assert.deepEqual(tiles(content), {
      Connected: [0, 'neutral'],
      Disconnected: [0, 'neutral'],
      Total: [0, 'primary'],
    });
    assert.match(of(content, 'text')[0].text, /^NetBird answers, but no peer is in this view/);
    assert.doesNotMatch(JSON.stringify(content), /does not answer/);
    assert.deepEqual(
      of(content, 'status')[0].items.map((i) => [i.label, i.value]),
      [
        ['NetBird', 'answers'],
        ['Last reading', '2026-10-17 08:00 UTC'],
      ],
    );
  }
  // An outage after a reading with no peer: the zeros stay, in red.
  const outage = build({ state: 'error', peers: [] });
  assertWithinSdk(outage);
  assert.deepEqual(tiles(outage).Total, [0, 'danger']);
});

test('S2: waiting with known peers (Gladys reconnected): info, consistently', () => {
  const content = build({ state: 'waiting' });
  assertWithinSdk(content);
  assert.ok(of(content, 'value').every((t) => t.color === 'info'));
  assert.deepEqual(
    of(content, 'status')[0].items.map((i) => i.color),
    ['info', 'info'],
  );
  assert.ok(list(content).items.every((i) => i.badge.color === 'neutral'));
});

test('S3: a peer without a state is "unknown", counted apart, never red', () => {
  const sample = peers([
    ['a', 'NAS', {}],
    ['b', 'Box', {}],
    ['c', 'Laptop', { connected: false, last_seen: '2026-10-16T21:30:00Z' }],
  ]);
  sample[1].connected = null;
  const content = build({ peers: sample, settings: { watch: [deviceOf('b')] } });
  assertWithinSdk(content);
  assert.deepEqual(tiles(content), {
    Connected: [1, 'success'],
    Disconnected: [1, 'neutral'],
    Total: [3, 'primary'],
    Unknown: [1, 'neutral'],
  });
  assert.equal(of(content, 'status')[0].items.length, 2, 'not "Watched, offline"');
  assert.deepEqual(
    list(content).items.map((i) => [i.title, i.badge.text, i.badge.color]),
    [
      ['NAS', 'online', 'success'],
      ['Laptop', 'offline', 'neutral'],
      ['Box', 'unknown', 'neutral'],
    ],
  );
  const disconnected = build({ peers: sample, settings: { filter: 'disconnected' } });
  assert.deepEqual(
    list(disconnected).items.map((i) => i.title),
    ['Laptop'],
  );
  const fr = build({ peers: sample, language: 'fr' });
  assert.deepEqual(tiles(fr).Inconnus, [1, 'neutral']);
});

test('S4: a watched peer missing from the reading is "not found", in red', () => {
  // The created devices of the integration, as the connected SDK holds them.
  const fake = Object.defineProperty(Object.create(gladys), 'devices', {
    value: [buildPeerDevice(gladys, { id: 'gone0000000000000000', name: 'Old NAS' })],
  });
  const content = build({
    gladys: fake,
    settings: { watch: [deviceOf('gone0000000000000000'), deviceOf('nodevice00000000000')] },
  });
  assertWithinSdk(content);
  assert.deepEqual(of(content, 'status')[0].items.slice(2), [
    { label: 'Watched, not found', value: 'Old NAS', icon: 'alert-triangle', color: 'danger' },
    {
      label: 'Watched, not found',
      value: 'nodevice00000000000',
      icon: 'alert-triangle',
      color: 'danger',
    },
  ]);
  const fr = build({
    gladys: fake,
    language: 'fr',
    settings: { watch: [deviceOf('gone0000000000000000')] },
  });
  assert.equal(of(fr, 'status')[0].items.at(-1).label, 'Surveillé, introuvable');
});

test('long names and odd values stay within the limits', () => {
  const odd = peers([
    ['p0', 'N'.repeat(100), { ip: '100.92.0.1' }],
    ['p1', 'x', { ip: 'nope', connected: false, last_seen: '' }],
  ]);
  odd[0].dnsLabel = `${'a'.repeat(63)}.${'b'.repeat(63)}.netbird.cloud`;
  odd[1].connected = null;
  odd[0].groups = Array.from({ length: 200 }, (_, i) => ({ id: `g${i}`, name: 'G'.repeat(100) }));
  const content = build({ peers: odd, settings: { watch: [deviceOf('p0')] } });
  assertWithinSdk(content);
  const [long, unknown] = list(content).items;
  assert.equal(long.subtitle, '100.92.0.1', 'the IP first when both do not fit');
  assert.ok(long.title.endsWith('…'));
  assert.deepEqual(unknown.badge, { text: 'unknown', color: 'neutral' });
  assert.equal(unknown.subtitle, 'x.netbird.cloud');
});

// --- The app ---------------------------------------------------------------------

let running;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function setup({ config = {}, netbird = createFakeNetbird() } = {}) {
  const clock = { now: T0 };
  const fake = createFakeGladys({
    selector: SELECTOR,
    config: { token: TOKEN, ...config },
    devices: [
      ...netbird.peers.map((p) => buildPeerDevice(gladys, { id: p.id, name: p.name })),
      buildNetworkDevice(gladys),
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
    gladys: fake,
    logger,
    request: netbird.request,
    dataDir: mkdtempSync(join(tmpdir(), 'nb-widget-')),
    now: () => clock.now,
    timers,
  });
  running = app;
  registerHandlers(fake, app, logger);
  await fake.connect();
  return { gladys: fake, netbird, timers, clock, logs, app };
}

const widget = async (fake, options) => {
  const ack = await fake.fake.widgetGet(WIDGETS.PEERS, options);
  assert.equal(ack.success, true, JSON.stringify(ack));
  return ack.data.content;
};

test('app: the widget comes from the last reading, no request to NetBird, ttl = interval', async () => {
  const { gladys: fake, netbird, logs } = await setup({ config: { poll_interval: '300' } });
  const before = netbird.requests.length;
  const content = await widget(fake, { settings: { filter: 'all' }, language: 'fr' });
  assertWithinSdk(content);
  assert.equal(netbird.requests.length, before, 'no request of its own');
  assert.equal(content.ttl_seconds, 300);
  assert.deepEqual(
    list(content).items.map((i) => [i.title, i.subtitle, i.badge.text]),
    [
      ['NAS', '100.92.10.1 · nas.netbird.cloud', 'en ligne'],
      ['Phone', '100.92.10.3 · phone.netbird.cloud', 'en ligne'],
      ['Laptop', '100.92.10.2 · laptop.netbird.cloud', 'hors ligne'],
    ],
  );
  // Laptop: SSO peer, last login 2026-10-16 20:00 + 24 h of the account.
  assert.match(
    list(content).items[2].description,
    /Expiration de la connexion : 2026-10-17 20:00 UTC/,
  );
  // No secret, no public IP, no location, no e-mail, no address of the server.
  const sent = JSON.stringify(content);
  for (const secret of [
    TOKEN,
    'nbp_',
    '203.0.113.7',
    'Paris',
    'gladys@example.org',
    'google-oauth2',
    'api.netbird.io',
  ]) {
    assert.ok(!sent.includes(secret), secret);
  }
  // Nothing about the peers in the logs.
  const logged = logs.join('\n');
  for (const value of ['100.92.10', 'Laptop', 'netbird.cloud'])
    assert.ok(!logged.includes(value), value);
});

test('app: a refused token or a missing one gives an empty state, never an error', async () => {
  const netbird = createFakeNetbird();
  const { gladys: fake } = await setup({ config: { token: 'nbp_wrong' }, netbird });
  const refused = await widget(fake, { settings: {} });
  assertWithinSdk(refused);
  assert.match(refused.components[0].text, /refused the access token/);
  assert.ok(!JSON.stringify(refused).includes('nbp_'));

  const { gladys: empty } = await setup({ config: { token: '' } });
  const config = await widget(empty, { settings: {} });
  assertWithinSdk(config);
  assert.match(config.components[0].text, /not configured/);
});

test('app: an outage keeps the last peers with a red status; a nudge on every change', async () => {
  const { gladys: fake, netbird, timers, clock } = await setup();
  assert.deepEqual(fake.fake.widgetRefreshes, ['peers'], 'after the first reading');

  // Nothing changes: no nudge.
  clock.now += 60_000;
  await timers.run((d) => d === 60_000);
  assert.equal(fake.fake.widgetRefreshes.length, 1);

  // A peer disconnects: one nudge.
  netbird.peers.find((p) => p.name === 'Phone').connected = false;
  clock.now += 60_000;
  await timers.run((d) => d === 60_000);
  assert.equal(fake.fake.widgetRefreshes.length, 2);

  // NetBird asks to slow down: the widget says so (warning), one nudge, no
  // request while the pause lasts.
  netbird.failures.push({ path: '/api/peers', status: 429, headers: { 'retry-after': '600' } });
  clock.now += 60_000;
  await timers.run((d) => d === 60_000);
  assert.equal(fake.fake.widgetRefreshes.length, 3);
  const requests = netbird.requests.length;
  const paused = await widget(fake, { settings: { filter: 'disconnected' } });
  assertWithinSdk(paused);
  assert.equal(netbird.requests.length, requests);
  assert.equal(of(paused, 'status')[0].items[0].value, 'paused (HTTP 429 or 5xx)');
  assert.deepEqual(
    list(paused).items.map((i) => i.title),
    ['Phone', 'Laptop'],
  );
  assert.ok(of(paused, 'value').every((t) => t.color === 'warning'));
});

test('app: never two nudges within 10 s; the change held back goes at the next check', async () => {
  const { gladys: fake, netbird, timers, clock } = await setup();
  assert.equal(fake.fake.widgetRefreshes.length, 1);
  netbird.peers.find((p) => p.name === 'NAS').connected = false;
  clock.now += 5_000;
  await timers.run((d) => d === 60_000);
  assert.equal(fake.fake.widgetRefreshes.length, 1, 'held back: 5 s after the last one');
  clock.now += 60_000;
  await timers.run((d) => d === 60_000);
  assert.equal(fake.fake.widgetRefreshes.length, 2, 'sent at the next reading');
});

test('app S13: NetBird answers with no followed peer: zeros, never "does not answer"', async () => {
  const { gladys: fake } = await setup({ config: { groups: 'no-such-group' } });
  assert.equal(fake.fake.connectionStatus.connected, true);
  const content = await widget(fake, { settings: {} });
  assertWithinSdk(content);
  assert.deepEqual(
    of(content, 'value').map((t) => t.value),
    [0, 0, 0],
  );
  assert.match(content.components.find((c) => c.type === 'text').text, /NetBird answers/);
  assert.deepEqual(
    of(content, 'status')[0].items.map((i) => i.value),
    ['answers', '2026-10-17 08:00 UTC'],
  );
});

test('app S9: a token of another account never shows the peers of the previous one', async () => {
  const { gladys: fake, netbird, app } = await setup();
  assert.equal(list(await widget(fake, { settings: {} })).items.length, 3);
  const before = app.knownKey(app.config);
  assert.ok(!before.includes(TOKEN), 'a fingerprint, never the token');
  netbird.unreachable = true;
  await fake.fake.configUpdated({ token: 'nbp_OtherAccountToken0123456789abcdef' });
  const content = await widget(fake, { settings: {} });
  assertWithinSdk(content);
  assert.equal(list(content), undefined, 'no peer of the other account');
  assert.equal(of(content, 'status')[0].items[0].value, 'no answer');
  assert.notEqual(app.knownKey(app.config), before);
});

test('app: a new last login (login expiry) nudges the widget', async () => {
  const { gladys: fake, netbird, timers, clock } = await setup();
  assert.equal(fake.fake.widgetRefreshes.length, 1);
  netbird.peers.find((p) => p.name === 'Laptop').last_login = '2026-10-17T07:00:00Z';
  clock.now += 60_000;
  await timers.run((d) => d === 60_000);
  assert.equal(fake.fake.widgetRefreshes.length, 2);
});

test('app: a failure in the widget code gives a text, not an exception', async () => {
  const { gladys: fake, app, logs } = await setup();
  app.knownPeers = () => {
    throw new Error('boom');
  };
  const content = await widget(fake, { settings: {} });
  assertWithinSdk(content);
  assert.equal(content.components[0].variant, 'body');
  assert.ok(logs.some((l) => l.includes('Widget not built')));
});
