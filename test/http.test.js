// -----------------------------------------------------------------------------
// The real transport (node:http / node:https) against loopback servers only.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { NetbirdClient } from '../src/netbird/client.js';
import { CODES, isTokenRefused } from '../src/netbird/errors.js';
import { httpRequest } from '../src/netbird/http.js';
import { TOKEN, createFakeNetbird } from './helpers/fakeNetbird.js';

const tlsFile = (name) => readFileSync(new URL(`./fixtures/tls/${name}`, import.meta.url));
const TLS = { key: tlsFile('server.key'), cert: tlsFile('server.pem') };
const certFingerprint = new X509Certificate(tlsFile('server.pem')).fingerprint256;

async function serve(handler, { secure = false } = {}) {
  const requests = [];
  const listener = (req, res) => {
    req.resume();
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers });
      handler(req, res);
    });
  };
  const server = secure ? https.createServer(TLS, listener) : http.createServer(listener);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `${secure ? 'https' : 'http'}://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

const okJson = (_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('[]');
};

test('GET, the size cap, no redirect followed', async () => {
  const server = await serve((req, res) => {
    if (req.url.startsWith('/big')) {
      res.writeHead(200);
      res.end(Buffer.alloc(5000));
      return;
    }
    if (req.url.startsWith('/moved')) {
      res.writeHead(302, { location: 'https://elsewhere.example/' });
      res.end();
      return;
    }
    okJson(req, res);
  });
  try {
    const get = await httpRequest(`${server.url}/a?b=1`, {
      timeout: 2000,
      maxBytes: 1000,
      allowHttp: true,
    });
    assert.equal(get.status, 200);
    assert.equal(get.body.toString(), '[]');
    assert.equal(server.requests[0].method, 'GET');
    await assert.rejects(
      httpRequest(`${server.url}/big`, { timeout: 2000, maxBytes: 1000, allowHttp: true }),
      (err) => err.code === CODES.TOO_LARGE,
    );
    const moved = await httpRequest(`${server.url}/moved`, {
      timeout: 2000,
      maxBytes: 1000,
      allowHttp: true,
    });
    assert.equal(moved.status, 302);
    assert.equal(server.requests.length, 3);
  } finally {
    await server.close();
  }
});

test('plain http is refused unless a test allows it: nothing is sent', async () => {
  const server = await serve(okJson);
  try {
    await assert.rejects(
      httpRequest(server.url, { timeout: 2000, maxBytes: 1000, headers: { authorization: 'x' } }),
      (err) => err.name === 'NetbirdError',
    );
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
  }
});

test('the client sends its user-agent', async () => {
  const fake = createFakeNetbird();
  const client = new NetbirdClient({
    server: { base: 'https://x.test' },
    token: TOKEN,
    request: fake.request,
  });
  await client.peers();
  assert.match(fake.requests[0].headers['user-agent'], /^gladys-netbird\/\d+\.\d+\.\d+$/);
});

test('no answer in time, nobody listening', async () => {
  const server = await serve(() => {}); // never answers
  try {
    await assert.rejects(
      httpRequest(server.url, { timeout: 200, maxBytes: 1000, allowHttp: true }),
      (err) => err.code === CODES.TIMEOUT,
    );
  } finally {
    await server.close();
  }
  await assert.rejects(
    httpRequest(server.url, { timeout: 2000, maxBytes: 1000, allowHttp: true }),
    (err) => err.code === CODES.UNREACHABLE,
  );
});

test('https: a certificate of an unknown authority is refused by default, before any request', async () => {
  const server = await serve(okJson, { secure: true });
  try {
    await assert.rejects(
      httpRequest(server.url, { timeout: 2000, maxBytes: 1000, headers: { authorization: 'x' } }),
      (err) => err.code === CODES.TLS_UNTRUSTED,
    );
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
  }
});

test('https, typed fingerprint: exactly this certificate, nothing else', async () => {
  const server = await serve(okJson, { secure: true });
  try {
    const ok = await httpRequest(`${server.url}/a`, {
      timeout: 2000,
      maxBytes: 1000,
      tls: { fingerprint: certFingerprint.replace(/:/g, '').toLowerCase() },
    });
    assert.equal(ok.status, 200);
    await assert.rejects(
      httpRequest(`${server.url}/b`, {
        timeout: 2000,
        maxBytes: 1000,
        headers: { authorization: 'Token secret' },
        tls: { fingerprint: 'AB'.repeat(32) },
      }),
      (err) => err.code === CODES.TLS_CHANGED,
    );
    assert.equal(server.requests.length, 1, 'the token never left');
  } finally {
    await server.close();
  }
});

test('a header Node refuses (invisible character) is a failure, never a crash', async () => {
  const plain = await serve(okJson);
  const secure = await serve(okJson, { secure: true });
  try {
    const headers = { authorization: 'Token nbp_a​b' };
    await assert.rejects(
      httpRequest(plain.url, { timeout: 2000, maxBytes: 1000, headers, allowHttp: true }),
      (err) => err.name === 'NetbirdError',
    );
    // After the handshake (secureConnect).
    await assert.rejects(
      httpRequest(secure.url, {
        timeout: 2000,
        maxBytes: 1000,
        headers,
        tls: { fingerprint: certFingerprint },
      }),
      (err) => err.name === 'NetbirdError',
    );
    assert.equal(plain.requests.length + secure.requests.length, 0);
  } finally {
    await plain.close();
    await secure.close();
  }
});

test('the client over the real transport: the token in Authorization only', async () => {
  const fake = createFakeNetbird();
  const server = await fake.listen(TLS);
  try {
    const client = new NetbirdClient({
      server: { base: `https://127.0.0.1:${server.port}` },
      token: TOKEN,
      fingerprint: certFingerprint,
    });
    assert.equal(await client.currentUser(), null, 'a service user gets 403 there');
    const { peers } = await client.peers();
    assert.equal(peers.length, 3);
    assert.deepEqual(await client.account(), {
      loginExpirationEnabled: true,
      loginExpirationSeconds: 86_400,
    });
    for (const request of fake.requests) {
      assert.equal(request.headers.authorization, `Token ${TOKEN}`);
      assert.ok(!decodeURIComponent(request.url).includes(TOKEN));
    }
    // A 403 of the API (JSON) is a refusal; a 403 page in front of it is not.
    fake.failures.push({ path: '/api/peers', status: 403 });
    await assert.rejects(client.peers(), (err) => isTokenRefused(err));
    fake.failures.push({ path: '/api/peers', status: 403, body: '<html>WAF</html>' });
    await assert.rejects(client.peers(), (err) => err.status === 403 && !isTokenRefused(err));
    // Only the envelope of NetBird: { message: <text>, code: <the status> }.
    fake.failures.push({ path: '/api/peers', status: 403, body: '{"error":"forbidden"}' });
    await assert.rejects(client.peers(), (err) => err.status === 403 && !isTokenRefused(err));
    fake.failures.push({ path: '/api/peers', status: 403, body: '{"message":"x","code":401}' });
    await assert.rejects(client.peers(), (err) => err.status === 403 && !isTokenRefused(err));
    fake.failures.push({ path: '/api/users/current', status: 401 });
    assert.equal(await client.currentUser(), null, 'the peers decide');
    fake.failures.push({ path: '/api/accounts', status: 401 });
    await assert.rejects(client.account(), (err) => err.status === 401 && !isTokenRefused(err));
    fake.failures.push({ path: '/api/peers', status: 200, body: 'not json' });
    await assert.rejects(client.peers(), (err) => err.code === CODES.BAD_ANSWER);
  } finally {
    await server.close();
  }
});
