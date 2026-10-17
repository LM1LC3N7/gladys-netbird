// -----------------------------------------------------------------------------
// The REST management API of NetBird (NetBird Cloud at api.netbird.io, or a
// self-hosted management server), with a personal access token. Read only:
//   GET /api/users/current   the user of the token (optional: a service user
//                            gets 403, an older server 404 / 405)
//   GET /api/peers           every peer the token sees
//   GET /api/accounts        the account settings (login expiration)
// The token goes in the `Authorization: Token <PAT>` header only (never in a
// URL, never in a log). Nothing of NetBird's own code is used: only its
// documented API.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { MAX_BYTES, TIMEOUTS } from '../constants.js';
import { CODES, NetbirdError, isNetbirdEnvelope } from './errors.js';
import { httpRequest } from './http.js';
import { parseAccount, parsePeers, parseUser } from './parse.js';

const asNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Seconds of a Retry-After header (delta form only), in ms, or null. */
const retryAfterMs = (value) => {
  const seconds = asNumber(Array.isArray(value) ? value[0] : value);
  return seconds !== null && seconds >= 0 ? seconds * 1000 : null;
};

/** gladys-netbird/<version>, from package.json (copied into the image). */
export const USER_AGENT = (() => {
  try {
    const { version } = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    return typeof version === 'string' ? `gladys-netbird/${version}` : 'gladys-netbird';
  } catch {
    return 'gladys-netbird';
  }
})();

export class NetbirdClient {
  /**
   * @param {object} options
   * @param {{ base: string }} options.server the management API (no trailing `/api`)
   * @param {string} options.token the personal access token
   * @param {string | null} [options.fingerprint] SHA-256 fingerprint typed by the user
   * @param {Function} [options.request] the HTTP transport (tests inject a fake NetBird)
   */
  constructor({ server, token, fingerprint = null, request = httpRequest }) {
    this.server = server;
    this.token = token;
    this.fingerprint = fingerprint;
    this.request = request;
    this.closed = false;
  }

  close() {
    this.closed = true;
  }

  /** One GET. Resolves the parsed JSON; rejects a NetbirdError (HTTP with its status). */
  async get(path, { maxBytes }) {
    if (this.closed) throw new NetbirdError(CODES.CLOSED, 'Client closed');
    const response = await this.request(`${this.server.base}${path}`, {
      headers: { authorization: `Token ${this.token}`, 'user-agent': USER_AGENT },
      timeout: TIMEOUTS.API,
      maxBytes,
      tls: this.fingerprint ? { fingerprint: this.fingerprint } : {},
    });
    if (response.status < 200 || response.status > 299) {
      throw new NetbirdError(CODES.HTTP, `HTTP ${response.status}`, {
        status: response.status,
        retryAfterMs: retryAfterMs(response.headers?.['retry-after']),
        path,
        envelope: isNetbirdEnvelope(response.body ?? Buffer.alloc(0), response.status),
      });
    }
    try {
      return JSON.parse(response.body.toString('utf8'));
    } catch {
      throw new NetbirdError(CODES.BAD_ANSWER, 'Not JSON', { path });
    }
  }

  /**
   * The user of the token, or null when it cannot be read: NetBird answers
   * 403 to every service user, an older server 404 / 405, and a 401 is left
   * to /api/peers to decide. Only 429, 5xx and transport failures throw
   * (they pause or retry like any reading).
   */
  async currentUser() {
    try {
      return parseUser(await this.get('/api/users/current', { maxBytes: MAX_BYTES.USER }));
    } catch (err) {
      if (err.code === CODES.HTTP && [401, 403, 404, 405].includes(err.status)) return null;
      throw err;
    }
  }

  async peers() {
    const parsed = parsePeers(await this.get('/api/peers', { maxBytes: MAX_BYTES.PEERS }));
    if (!parsed)
      throw new NetbirdError(CODES.BAD_ANSWER, 'Not a list of peers', { path: '/api/peers' });
    return parsed;
  }

  /** The login expiration settings, or null when the answer does not say. */
  async account() {
    return parseAccount(await this.get('/api/accounts', { maxBytes: MAX_BYTES.ACCOUNT }));
  }
}
