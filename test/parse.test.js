import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_EXPIRY,
  cleanText,
  formatDate,
  loginExpiry,
  parseAccount,
  parseIp,
  parsePeers,
  parseUser,
} from '../src/netbird/parse.js';
import { netbirdPeer } from './helpers/fakeNetbird.js';

test('peers: kept fields only, sorted by id, invalid and duplicate ids left out', () => {
  const parsed = parsePeers([
    netbirdPeer('b2', 'Beta'),
    netbirdPeer('a1', 'Alpha', { connected: false }),
    netbirdPeer('a1', 'Alpha again'),
    { ...netbirdPeer('x', 'Bad'), id: 'with:colon' },
    { id: 42 },
    null,
  ]);
  assert.equal(parsed.invalid, 3);
  assert.deepEqual(
    parsed.peers.map((p) => [p.id, p.name, p.connected]),
    [
      ['a1', 'Alpha', false],
      ['b2', 'Beta', true],
    ],
  );
  assert.deepEqual(Object.keys(parsed.peers[0]).sort(), [
    'connected',
    'groups',
    'id',
    'ip',
    'lastLogin',
    'lastSeen',
    'loginExpirationEnabled',
    'loginExpired',
    'name',
    'version',
  ]);
  assert.equal(parsePeers({ peers: [] }), null);
});

test('peers: odd values become unknown, never a crash', () => {
  const [peer] = parsePeers([
    {
      id: 'p1',
      name: '  ',
      hostname: 'host\u0000name',
      ip: '999.1.1.1',
      connected: 'yes',
      last_seen: '0001-01-01T00:00:00Z',
      version: 'x'.repeat(500),
      groups: 'nope',
    },
  ]).peers;
  assert.equal(peer.name, 'host name');
  assert.equal(peer.ip, null);
  assert.equal(peer.connected, null);
  assert.equal(peer.lastSeen, null, 'the zero time of Go');
  assert.equal(peer.version.length, 40);
  assert.deepEqual(peer.groups, []);
});

test('ip, text and date helpers', () => {
  assert.equal(parseIp('100.92.1.2'), '100.92.1.2');
  assert.equal(parseIp('FD00::1'), 'fd00::1');
  assert.equal(parseIp('abc'), null);
  assert.equal(cleanText('a​\nb'), 'a b');
  assert.equal(cleanText(''), null);
  assert.equal(formatDate(Date.parse('2026-10-17T07:59:59.9Z')), '2026-10-17 07:59 UTC');
});

test('account settings: the login expiration', () => {
  assert.deepEqual(
    parseAccount([
      { settings: { peer_login_expiration_enabled: true, peer_login_expiration: 3600 } },
    ]),
    { loginExpirationEnabled: true, loginExpirationSeconds: 3600 },
  );
  assert.deepEqual(parseAccount([{ settings: { peer_login_expiration_enabled: false } }]), {
    loginExpirationEnabled: false,
    loginExpirationSeconds: null,
  });
  assert.equal(
    parseAccount([
      { settings: { peer_login_expiration_enabled: true, peer_login_expiration: -1 } },
    ]),
    null,
  );
  assert.equal(parseAccount([]), null);
  assert.equal(parseAccount('x'), null);
});

test('the user of the token: no name, no e-mail kept', () => {
  assert.deepEqual(
    parseUser({ email: 'a@b.c', name: 'A', role: 'admin', permissions: { is_restricted: true } }),
    { serviceUser: false, restricted: true, role: 'admin' },
  );
  assert.equal(parseUser([]), null);
});

test('login expiry: a date, never, or unknown', () => {
  const account = { loginExpirationEnabled: true, loginExpirationSeconds: 86_400 };
  const sso = {
    loginExpirationEnabled: true,
    lastLogin: Date.parse('2026-10-16T20:00:00Z'),
  };
  assert.equal(loginExpiry(sso, account), '2026-10-17 20:00 UTC');
  assert.equal(loginExpiry({ ...sso, loginExpirationEnabled: false }, account), NO_EXPIRY);
  assert.equal(loginExpiry(sso, { loginExpirationEnabled: false }), NO_EXPIRY);
  assert.equal(loginExpiry(sso, null), null, 'account unreadable');
  assert.equal(loginExpiry({ ...sso, lastLogin: null }, account), null);
  assert.equal(loginExpiry({ ...sso, loginExpirationEnabled: null }, account), null);
});
