// -----------------------------------------------------------------------------
// A fake NetBird management API (in memory, or on loopback through listen()):
// the three GET endpoints the integration uses. The shapes come from the
// public API reference (docs.netbird.io/api); never checked against a real
// NetBird (TODO.md).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { CODES, NetbirdError } from '../../src/netbird/errors.js';

export const TOKEN = 'nbp_FakeToken0123456789abcdefghijklmn';

export function netbirdPeer(id, name, options = {}) {
  return {
    id,
    name,
    created_at: '2026-01-10T08:00:00Z',
    ip: options.ip ?? '100.92.10.1',
    ipv6: '',
    connection_ip: '203.0.113.7',
    connected: options.connected ?? true,
    last_seen: options.last_seen ?? '2026-10-17T07:59:12.123456Z',
    os: 'Debian GNU/Linux 12',
    kernel_version: '6.1.0',
    geoname_id: 2988507,
    version: options.version ?? '0.59.1',
    groups: options.groups ?? [{ id: 'grp0000000000000all', name: 'All', peers_count: 3 }],
    ssh_enabled: false,
    user_id: 'google-oauth2|123',
    hostname: name.toLowerCase(),
    ui_version: '',
    dns_label: `${name.toLowerCase()}.netbird.cloud`,
    login_expiration_enabled: options.login_expiration_enabled ?? false,
    login_expired: options.login_expired ?? false,
    last_login: options.last_login ?? '2026-10-16T20:00:00Z',
    inactivity_expiration_enabled: false,
    approval_required: false,
    country_code: 'FR',
    city_name: 'Paris',
    serial_number: '',
    extra_dns_labels: [],
    ephemeral: false,
    accessible_peers_count: 2,
  };
}

export function createFakeNetbird() {
  const fake = {
    requests: [],
    peers: [
      netbirdPeer('cq1aaaaaaaaaaaaaaaa0', 'NAS', {
        ip: '100.92.10.1',
        groups: [
          { id: 'grp0000000000000all', name: 'All' },
          { id: 'grp00000000servers0', name: 'Servers' },
        ],
      }),
      netbirdPeer('cq1aaaaaaaaaaaaaaaa1', 'Laptop', {
        ip: '100.92.10.2',
        connected: false,
        login_expiration_enabled: true,
        last_seen: '2026-10-16T21:30:00Z',
      }),
      netbirdPeer('cq1aaaaaaaaaaaaaaaa2', 'Phone', { ip: '100.92.10.3', version: '0.58.0' }),
    ],
    account: [
      {
        id: 'acc00000000000000000',
        settings: { peer_login_expiration_enabled: true, peer_login_expiration: 86_400 },
        domain: 'example.org',
      },
    ],
    user: {
      id: 'svc',
      email: 'gladys@example.org',
      name: 'gladys',
      role: 'user',
      is_service_user: true,
      permissions: { is_restricted: false },
    },
    /** path -> { status, headers, body } answered once (FIFO). */
    failures: [],
    unreachable: false,
  };

  const json = (status, value, headers = {}) => ({
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: Buffer.from(JSON.stringify(value)),
  });

  function answer(url, headers) {
    const path = url.pathname;
    const failure = fake.failures.findIndex((f) => path === f.path);
    if (failure !== -1) {
      const [f] = fake.failures.splice(failure, 1);
      if (f.body !== undefined) {
        return { status: f.status, headers: f.headers ?? {}, body: Buffer.from(f.body) };
      }
      return json(f.status, { message: 'failure', code: f.status }, f.headers ?? {});
    }
    if (headers.authorization !== `Token ${TOKEN}`) {
      return json(401, { message: 'token invalid', code: 401 });
    }
    if (path === '/api/users/current') return json(200, fake.user);
    if (path === '/api/peers') return json(200, fake.peers);
    if (path === '/api/accounts') return json(200, fake.account);
    return json(404, { message: 'not found', code: 404 });
  }

  /** The transport of src/netbird/http.js, in memory. */
  fake.request = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    const headers = Object.fromEntries(
      Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    fake.requests.push({ url: rawUrl, path: url.pathname, headers });
    if (fake.unreachable) throw new NetbirdError(CODES.UNREACHABLE, 'ECONNREFUSED');
    return answer(url, headers);
  };

  /** The same API on a loopback server (https when `tls` gives key and cert): { url, close }. */
  fake.listen = async (tls) => {
    const listener = (req, res) => {
      req.resume();
      req.on('end', () => {
        const url = new URL(req.url, 'http://127.0.0.1');
        fake.requests.push({ url: req.url, path: url.pathname, headers: req.headers });
        const result = answer(url, req.headers);
        res.writeHead(result.status, result.headers);
        res.end(result.body);
      });
    };
    const server = tls ? https.createServer(tls, listener) : http.createServer(listener);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
      url: `${tls ? 'https' : 'http'}://127.0.0.1:${port}`,
      port,
      close: () =>
        new Promise((resolve) => {
          server.closeAllConnections?.();
          server.close(resolve);
        }),
    };
  };

  return fake;
}
