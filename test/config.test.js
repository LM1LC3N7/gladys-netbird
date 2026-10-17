import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesFilter, normalizeConfig, parseGroupFilter, parseServerUrl } from '../src/config.js';

test('the server address: NetBird Cloud by default, self-hosted in https only', () => {
  assert.deepEqual(parseServerUrl(''), {
    base: 'https://api.netbird.io',
    origin: 'https://api.netbird.io',
    hostname: 'api.netbird.io',
    port: 443,
    cloud: true,
  });
  assert.equal(parseServerUrl('https://api.netbird.io/api').cloud, true);
  assert.equal(parseServerUrl('https://app.netbird.io').cloud, true, 'the dashboard: its API');
  assert.equal(parseServerUrl('netbird.example.org').base, 'https://netbird.example.org');
  assert.equal(
    parseServerUrl('https://NetBird.example.org:443/').base,
    'https://netbird.example.org',
  );
  assert.equal(
    parseServerUrl('https://example.org:33073/netbird/api/').base,
    'https://example.org:33073/netbird',
  );
  assert.equal(parseServerUrl('[fd00::1]:8443').base, 'https://[fd00::1]:8443');
  assert.deepEqual(parseServerUrl('http://netbird.example.org'), { error: 'http' });
  assert.deepEqual(parseServerUrl('https://a:b@example.org'), { error: 'credentials' });
  for (const bad of [
    'ftp://x',
    'https://x/?a=1',
    'https://x/#y',
    'https://x:99999',
    'https://x/a;b',
  ]) {
    assert.ok(parseServerUrl(bad).error, bad);
  }
});

test('the group filter: names without case, or ids', () => {
  assert.equal(parseGroupFilter(''), null);
  const filter = parseGroupFilter(' Servers ; grp123 ,');
  const peer = (groups) => ({ groups });
  assert.ok(matchesFilter(filter, peer([{ id: 'x', name: 'servers' }])));
  assert.ok(matchesFilter(filter, peer([{ id: 'grp123', name: 'Other' }])));
  assert.ok(!matchesFilter(filter, peer([{ id: 'x', name: 'All' }])));
  assert.ok(!matchesFilter(filter, peer([])));
  assert.ok(matchesFilter(null, peer([])));
});

test('normalizeConfig: defaults, token and fingerprint checks', () => {
  const config = normalizeConfig({ token: ' nbp_abc ' });
  assert.equal(config.token, 'nbp_abc');
  assert.equal(config.tokenInvalid, false);
  assert.equal(config.pollSeconds, 60);
  assert.equal(config.server.cloud, true);
  assert.equal(normalizeConfig({ poll_interval: '5' }).pollSeconds, 60, 'unknown value: default');
  assert.equal(normalizeConfig({ poll_interval: '300' }).pollSeconds, 300);
  assert.equal(normalizeConfig({ token: 'nbp_a b' }).tokenInvalid, true);
  assert.equal(normalizeConfig({ certificate_fingerprint: 'zz' }).fingerprintInvalid, true);
  assert.equal(
    normalizeConfig({ certificate_fingerprint: 'ab'.repeat(32) }).fingerprint,
    Array(32).fill('AB').join(':'),
  );
  assert.equal(normalizeConfig(null).urlError, null);
});
