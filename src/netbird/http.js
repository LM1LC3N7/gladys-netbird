// -----------------------------------------------------------------------------
// The only network access of the integration: one GET to NetBird on
// node:https (node:http is kept for the loopback tests only: the
// configuration refuses http://). A deadline for the whole exchange, a size
// cap on the body, no redirect followed. Resolves { status, headers, body }
// for any status; rejects a NetbirdError for the transport failures.
//
// TLS: by default the certificate must be valid for the host name (a public
// or system authority: NetBird Cloud, a self-hosted server behind Let's
// Encrypt). For a self-hosted server with its own certificate, the user may
// type its SHA-256 fingerprint: the certificate must then be exactly this
// one, valid or not, and nothing else is ever accepted. The handshake is
// checked BEFORE the request is written, so the access token (an HTTP
// header) never reaches an unverified peer. No trust on first use.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { CODES, NetbirdError } from './errors.js';

const TLS_ERRORS = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_SIGNATURE_FAILURE',
]);

function transportError(err) {
  const code = String(err?.code ?? '');
  if (TLS_ERRORS.has(code)) {
    return new NetbirdError(CODES.TLS_UNTRUSTED, `Certificate refused (${code})`);
  }
  // Something answered, but not in HTTP / TLS (a wrong port or scheme).
  if (code.startsWith('HPE_') || code === 'EPROTO' || code.startsWith('ERR_SSL_')) {
    return new NetbirdError(CODES.BAD_ANSWER, `Not the expected protocol (${code})`);
  }
  return new NetbirdError(CODES.UNREACHABLE, code || 'Connection failed');
}

/** `AA:BB:...` upper case, from any spelling (colons, spaces or none). */
export function normalizeFingerprint(value) {
  const hex = String(value ?? '')
    .replace(/^sha-?256\s*(fingerprint)?\s*[:=]?\s*/i, '')
    .replace(/[\s:]/g, '')
    .toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g).join(':');
}

/**
 * @param {string} url absolute http(s) URL
 * @param {object} options
 * @param {Record<string, string>} [options.headers]
 * @param {number} options.timeout ms for the whole exchange
 * @param {number} options.maxBytes body size cap
 * @param {{ fingerprint?: string | null }} [options.tls]
 */
export function httpRequest(url, { headers = {}, timeout, maxBytes, tls: trust = {} } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const host = target.hostname.replace(/^\[(.*)\]$/, '$1');
    const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);
    const servername = net.isIP(host) ? undefined : host;
    let settled = false;
    let req = null;
    let socket = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        req?.destroy();
        socket?.destroy();
        reject(error);
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(
      () =>
        finish(new NetbirdError(CODES.TIMEOUT, `No answer within ${Math.round(timeout / 1000)} s`)),
      timeout,
    );

    const send = (createConnection) => {
      const options = {
        method: 'GET',
        host,
        port,
        path: `${target.pathname}${target.search}`,
        headers: { accept: 'application/json', host: target.host, ...headers },
      };
      let lib = http;
      if (createConnection) {
        options.createConnection = createConnection;
      } else if (target.protocol === 'https:') {
        lib = https;
        options.servername = servername;
        options.rejectUnauthorized = true;
        options.agent = false;
      }
      req = lib.request(options, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            finish(new NetbirdError(CODES.TOO_LARGE, `Answer above ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          finish(null, {
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', (err) => finish(transportError(err)));
      });
      req.on('error', (err) => finish(transportError(err)));
      req.end();
    };

    // lib.request throws synchronously on a header it refuses (an invisible
    // character in the token: ERR_INVALID_CHAR): a failure, never a crash.
    const safeSend = (createConnection) => {
      try {
        send(createConnection);
      } catch (err) {
        finish(transportError(err));
      }
    };

    const fixed = trust.fingerprint ? normalizeFingerprint(trust.fingerprint) : null;
    if (target.protocol !== 'https:' || !fixed) {
      safeSend();
      return;
    }

    // Typed fingerprint: handshake first, compare, then write the request.
    socket = tls.connect({ host, port, servername, rejectUnauthorized: false });
    socket.once('error', (err) => finish(transportError(err)));
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const fingerprint = String(cert?.fingerprint256 ?? '').toUpperCase();
      if (!fingerprint) {
        finish(new NetbirdError(CODES.TLS_UNTRUSTED, 'No certificate'));
        return;
      }
      if (fingerprint !== fixed) {
        finish(new NetbirdError(CODES.TLS_CHANGED, 'Not the certificate of the fingerprint'));
        return;
      }
      safeSend(() => socket);
    });
  });
}
