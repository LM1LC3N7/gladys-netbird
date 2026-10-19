// -----------------------------------------------------------------------------
// The answers of the NetBird management API, read into plain objects. Pure.
// Shapes from the public API reference (docs.netbird.io/api): never checked
// against a real NetBird yet (TODO.md). Only what the integration uses is
// kept: no e-mail, no public IP (`connection_ip`), no location. The OS and
// the DNS name are kept for the dashboard widget only.
// -----------------------------------------------------------------------------

import { LIMITS } from '../constants.js';

/** A NetBird id (an xid such as `chacbco6lnnbn6cg5s90`); never a `:`, safe in an external id. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Dates before 2000 are the zero time of Go (`0001-01-01T00:00:00Z`): unknown. */
const MIN_DATE = Date.UTC(2000, 0, 1);

/**
 * Control characters, zero-width characters, bidirectional marks and
 * isolates, word joiner and invisible operators, BOM: replaced by a space.
 */
const INVISIBLE = new RegExp(
  `[${[
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0x2028, 0x202e],
    [0x2060, 0x2064],
    [0x2066, 0x2069],
    [0xfeff, 0xfeff],
  ]
    .map(
      ([from, to]) =>
        `\\u${from.toString(16).padStart(4, '0')}-\\u${to.toString(16).padStart(4, '0')}`,
    )
    .join('')}]`,
  'g',
);

const bool = (value) => (typeof value === 'boolean' ? value : null);

/** A printable one-line text, cut to `max`; null when empty. */
export function cleanText(value, max = LIMITS.TEXT_LENGTH) {
  if (typeof value !== 'string') return null;
  const text = value.replace(INVISIBLE, ' ');
  const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return trimmed || null;
}

export function parseDate(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms >= MIN_DATE ? ms : null;
}

/** The NetBird IP of a peer (IPv4 `100.x.y.z` by default, or IPv6); null otherwise. */
export function parseIp(value) {
  if (typeof value !== 'string') return null;
  const ip = value.trim();
  if (/^(\d{1,3})(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every((n) => Number(n) <= 255)) {
    return ip;
  }
  if (/^[0-9a-f:]{2,39}$/i.test(ip) && ip.includes(':')) return ip.toLowerCase();
  return null;
}

/** The NetBird DNS name of a peer (`nas.netbird.cloud`); null when it is not a host name. */
export function parseDnsLabel(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase().replace(/\.$/, '');
  if (name.length === 0 || name.length > 253) return null;
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(name)
    ? name
    : null;
}

function parsePeer(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return null;
  const groups = Array.isArray(raw.groups)
    ? raw.groups
        .filter((g) => g && typeof g === 'object')
        .map((g) => ({
          id: typeof g.id === 'string' ? g.id : null,
          name: cleanText(g.name),
        }))
        .filter((g) => g.id || g.name)
        .slice(0, 200)
    : [];
  return {
    id: raw.id,
    name: cleanText(raw.name) ?? cleanText(raw.hostname) ?? raw.id,
    ip: parseIp(raw.ip),
    connected: bool(raw.connected),
    lastSeen: parseDate(raw.last_seen),
    version: cleanText(raw.version, 40),
    // Shown by the dashboard widget only (never published as a state).
    os: cleanText(raw.os, 60),
    dnsLabel: parseDnsLabel(raw.dns_label),
    loginExpired: bool(raw.login_expired),
    loginExpirationEnabled: bool(raw.login_expiration_enabled),
    lastLogin: parseDate(raw.last_login),
    groups,
  };
}

/**
 * GET /api/peers -> { peers: [...], invalid } sorted by id, or null when the
 * answer is not a list. A peer without a usable id is left out (counted in
 * `invalid`); a peer seen twice is kept once.
 */
export function parsePeers(json) {
  if (!Array.isArray(json)) return null;
  const byId = new Map();
  let invalid = 0;
  for (const raw of json) {
    const peer = parsePeer(raw);
    if (!peer) invalid += 1;
    else if (!byId.has(peer.id)) byId.set(peer.id, peer);
  }
  const peers = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { peers, invalid };
}

/** Ten years: a login expiration above it is not a value of NetBird. */
const MAX_EXPIRATION_S = 10 * 365 * 86_400;

/**
 * GET /api/accounts -> { loginExpirationEnabled, loginExpirationSeconds } of
 * the first account (a token belongs to one account), or null when the
 * answer does not say.
 */
export function parseAccount(json) {
  const account = Array.isArray(json) ? json[0] : json;
  const settings = account?.settings;
  if (!settings || typeof settings !== 'object') return null;
  const enabled = bool(settings.peer_login_expiration_enabled);
  const seconds = settings.peer_login_expiration;
  if (enabled === null) return null;
  const valid = Number.isInteger(seconds) && seconds > 0 && seconds <= MAX_EXPIRATION_S;
  if (enabled && !valid) return null;
  return { loginExpirationEnabled: enabled, loginExpirationSeconds: valid ? seconds : null };
}

/**
 * GET /api/users/current -> { serviceUser, restricted, role, peersRead,
 * ownPeersOnly }: whether the token sees every peer. No name, no e-mail is
 * kept. In NetBird, a regular user without the `peers.read` permission
 * (the User role) lists only the peers it owns, and none at all when the
 * account restricts the dashboard of regular users (`is_restricted`); a
 * service user reads everything.
 */
export function parseUser(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const role = typeof json.role === 'string' ? json.role.slice(0, 20).toLowerCase() : null;
  const peersRead = bool(json.permissions?.modules?.peers?.read);
  const restricted = json.permissions?.is_restricted === true;
  return {
    serviceUser: json.is_service_user === true,
    restricted,
    role,
    peersRead,
    // A service user reads every peer whatever its role (manager.go of
    // NetBird); otherwise `peers.read` decides when given, the role if not.
    ownPeersOnly:
      json.is_service_user !== true &&
      (restricted || (peersRead !== null ? !peersRead : role === 'user')),
  };
}

/** `2026-10-17 08:00 UTC`: the dates published as texts (no time zone guess). */
export function formatDate(ms) {
  if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** The text published when the login of a peer never expires. */
export const NO_EXPIRY = '—';

/**
 * When the login session of a peer expires, as a text: a date, NO_EXPIRY
 * when it never expires (expiration off for the account or the peer: a peer
 * added with a setup key), or null when it cannot be known (account
 * settings unreadable, no last login).
 */
export function loginExpiry(peer, account) {
  if (peer.loginExpirationEnabled === false) return NO_EXPIRY;
  if (!account) return null;
  if (!account.loginExpirationEnabled) return NO_EXPIRY;
  if (peer.loginExpirationEnabled !== true || peer.lastLogin === null) return null;
  return formatDate(peer.lastLogin + account.loginExpirationSeconds * 1000);
}
