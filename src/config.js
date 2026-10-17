// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { CLOUD_URL, POLL_INTERVALS } from './constants.js';
import { normalizeFingerprint } from './netbird/http.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = Object.freeze({
  poll_interval: '60',
});

/** What an HTTP header accepts as a token: printable ASCII, no space. */
const TOKEN_PATTERN = /^[\x21-\x7e]+$/;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * The management server: empty for NetBird Cloud (https://api.netbird.io),
 * else `https://host[:port][/path]` of a self-hosted server (a bare
 * `host[:port]` is read as https). A trailing `/api` is dropped; the
 * dashboard of NetBird Cloud (app.netbird.io) is read as its API
 * (api.netbird.io). http:// is
 * refused (the token would cross the network in clear), and so are
 * credentials, a query and a fragment (an address ends up in logs).
 *   -> { base, origin, hostname, port, cloud } or { error: 'invalid' | 'http' | 'credentials' }
 */
export function parseServerUrl(value) {
  const raw = text(value) || CLOUD_URL;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const full = hasScheme ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(full);
  } catch {
    return { error: 'invalid' };
  }
  if (url.protocol === 'http:') return { error: 'http' };
  if (url.protocol !== 'https:') return { error: 'invalid' };
  if (url.username || url.password) return { error: 'credentials' };
  if (url.search || url.hash || !url.hostname) return { error: 'invalid' };
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/api$/i, '')
    .replace(/\/+$/, '');
  if (path && !/^(\/[A-Za-z0-9._~%-]+)+$/.test(path)) return { error: 'invalid' };
  // `https://host:443` loses its port in URL (the default): read it from the text.
  const typedPort = /^[a-z][a-z0-9+.-]*:\/\/(?:\[[^\]]*\]|[^/:?#]*):(\d+)/i.exec(full);
  const port = typedPort ? Number(typedPort[1]) : 443;
  if (!(port > 0 && port < 65536)) return { error: 'invalid' };
  let hostname = url.hostname.toLowerCase();
  // The dashboard of NetBird Cloud is app.netbird.io; its API is api.netbird.io.
  if (hostname === 'app.netbird.io' && port === 443) hostname = 'api.netbird.io';
  const origin = port === 443 ? `https://${hostname}` : `https://${hostname}:${port}`;
  return {
    base: `${origin}${path}`,
    origin,
    hostname,
    port,
    cloud: `${origin}${path}` === CLOUD_URL,
  };
}

/**
 * The groups to follow: names or ids, separated by commas or semicolons
 * (names compared without case). Empty: every peer the token sees.
 */
export function parseGroupFilter(value) {
  const tokens = text(value)
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 50);
  if (tokens.length === 0) return null;
  return {
    ids: new Set(tokens),
    names: new Set(tokens.map((t) => t.toLowerCase())),
  };
}

/** Is this peer in one of the groups of the filter (or is there no filter)? */
export const matchesFilter = (filter, peer) =>
  !filter ||
  peer.groups.some(
    (group) =>
      (group.id && filter.ids.has(group.id)) ||
      (group.name && filter.names.has(group.name.toLowerCase())),
  );

export function normalizeConfig(raw = {}) {
  raw = raw ?? {};
  const server = parseServerUrl(raw.url);
  const pick = (key, list) => (list.includes(String(raw[key])) ? String(raw[key]) : DEFAULTS[key]);
  const typedFingerprint = text(raw.certificate_fingerprint);
  const fingerprint = typedFingerprint ? normalizeFingerprint(typedFingerprint) : null;
  const token = typeof raw.token === 'string' ? raw.token.trim() : '';
  return {
    server: server.error ? null : server,
    urlError: server.error ?? null,
    token,
    // An invisible character pasted with the token (U+200B...) would make
    // Node refuse the header: said to the user, never sent.
    tokenInvalid: token !== '' && !TOKEN_PATTERN.test(token),
    fingerprint,
    fingerprintInvalid: typedFingerprint !== '' && fingerprint === null,
    filter: parseGroupFilter(raw.groups),
    pollSeconds: Number(pick('poll_interval', POLL_INTERVALS)),
  };
}
