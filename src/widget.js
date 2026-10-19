// -----------------------------------------------------------------------------
// The "peers" dashboard widget. Pure: it renders the last reading of the app
// (never a request of its own).
//
//   tiles    connected, disconnected, total (of the groups of the widget),
//            unknown and login expired when there is one
//   focal    a card-list (list, 8 rows at most): connected peers first by
//            name, then the disconnected ones, most recently seen first,
//            then those whose state NetBird does not give
//   status   how NetBird answers, when it was last read, the watched peers
//            that are offline or not found
//   caption  "+N more" beyond the rows shown
//
// A refused token or a configuration to fix: an empty state (a text and the
// status), never an exception; so is an outage, a pause or a first reading
// pending while nothing was ever read. Once something was read, the last
// reading stays shown (the NetBird IPs rarely change), its colors telling
// how fresh it is: danger for an outage, warning for a pause asked by
// NetBird (429 or 5xx), info while the first reading after a restart is
// pending. A reading with no peer shows 0 / 0 / 0.
//
// Times: the `date` of a row is formatted by the dashboard in the time zone
// of the user; every time this module writes itself says "UTC".
//
// Privacy: only what the integration already keeps (no public IP, no
// location, no e-mail, no user); never the token nor the address of the
// server.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { matchesFilter, parseGroupFilter } from './config.js';
import { WIDGET_DEFAULTS, WIDGET_FILTERS, WIDGET_MAX_ITEMS } from './constants.js';
import { parseExternalId } from './devices.js';
import { T } from './i18n.js';
import { formatDate, loginExpiry } from './netbird/parse.js';

/** Caps of the content vocabulary of the SDK (README, "Dashboard widgets"). */
export const WIDGET_LIMITS = Object.freeze({
  ITEMS: 8,
  TITLE: 60,
  SUBTITLE: 60,
  DESCRIPTION: 2000,
  BADGE: 16,
  TILE_LABEL: 24,
  STATUS_ITEMS: 10,
  STATUS_TEXT: 40,
  CAPTION: 80,
  BODY: 300,
  /** Watched peers listed in the status (offline or not found). */
  WATCHED_IN_STATUS: 6,
  /** Pages of 3 rows cover the 500 peers followed at most. */
  PAGES: 170,
});

const STATE_COLORS = {
  ok: WIDGET_COLORS.SUCCESS,
  paused: WIDGET_COLORS.WARNING,
  error: WIDGET_COLORS.DANGER,
  refused: WIDGET_COLORS.DANGER,
  config: WIDGET_COLORS.DANGER,
  waiting: WIDGET_COLORS.INFO,
};

/** States that never show peers (they may not be those of this token). */
const ALWAYS_EMPTY = ['refused', 'config'];

/** 'fr' for a French dashboard, 'en' otherwise. */
export const languageOf = (language) =>
  typeof language === 'string' && language.toLowerCase().startsWith('fr') ? 'fr' : 'en';

/** Cut to `max` UTF-16 units with an ellipsis, never between the two halves of a pair. */
export function cut(text, max) {
  if (text.length <= max) return text;
  let end = max - 1;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

/**
 * The settings of a widget instance (validated by the core against the
 * manifest, read again here: a dashboard may hold an older shape). `watch`
 * maps a peer id to the external id of its device.
 */
export function widgetSettings(gladys, settings = {}) {
  settings = settings && typeof settings === 'object' ? settings : {};
  const filter = WIDGET_FILTERS.includes(settings.filter)
    ? settings.filter
    : WIDGET_DEFAULTS.filter;
  const max = WIDGET_MAX_ITEMS.includes(String(settings.max_items))
    ? Number(settings.max_items)
    : Number(WIDGET_DEFAULTS.max_items);
  const page = Number(settings.page);
  const watch = new Map();
  for (const externalId of Array.isArray(settings.watch) ? settings.watch.slice(0, 50) : []) {
    const parsed = parseExternalId(gladys, externalId);
    if (parsed?.kind === 'peer' && parsed.feature === null) watch.set(parsed.peerId, externalId);
  }
  return {
    filter,
    groups: parseGroupFilter(typeof settings.groups === 'string' ? settings.groups : ''),
    watch,
    maxItems: Math.min(max, WIDGET_LIMITS.ITEMS),
    page:
      Number.isInteger(page) && page >= 1
        ? Math.min(page, WIDGET_LIMITS.PAGES)
        : WIDGET_DEFAULTS.page,
  };
}

const byName = (a, b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1);

/**
 * Connected peers first by name, then the disconnected ones, most recently
 * seen first, then those NetBird gives no state for (`connected` null), by
 * name.
 */
export function sortPeers(peers) {
  const connected = peers.filter((p) => p.connected === true).sort(byName);
  const disconnected = peers
    .filter((p) => p.connected === false)
    .sort((a, b) => (b.lastSeen ?? -Infinity) - (a.lastSeen ?? -Infinity) || byName(a, b));
  const unknown = peers.filter((p) => p.connected !== true && p.connected !== false).sort(byName);
  return [...connected, ...disconnected, ...unknown];
}

function badgeOf(peer, { watch, stale, lang }) {
  // During an outage or a pause, a badge tells what was last read, never a
  // state of now: neutral.
  const color = (fresh) => (stale ? WIDGET_COLORS.NEUTRAL : fresh);
  if (peer.loginExpired === true) {
    return { text: T.widget.badges.expired[lang], color: color(WIDGET_COLORS.WARNING) };
  }
  if (peer.connected === true) {
    return { text: T.widget.badges.online[lang], color: color(WIDGET_COLORS.SUCCESS) };
  }
  if (peer.connected === false) {
    return {
      text: T.widget.badges.offline[lang],
      color: color(watch.has(peer.id) ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL),
    };
  }
  return { text: T.widget.badges.unknown[lang], color: WIDGET_COLORS.NEUTRAL };
}

function subtitleOf(peer) {
  const ip = peer.ip ?? '';
  if (!peer.dnsLabel) return ip || null;
  const both = ip ? `${ip} · ${peer.dnsLabel}` : peer.dnsLabel;
  return both.length <= WIDGET_LIMITS.SUBTITLE
    ? both
    : ip || cut(peer.dnsLabel, WIDGET_LIMITS.SUBTITLE);
}

/**
 * The details. The last connection is not repeated here: it is the `date`
 * of the row, shown by the dashboard in the time zone of the user.
 */
function descriptionOf(peer, account, lang) {
  const D = T.widget.details;
  const lines = [];
  const separator = lang === 'fr' ? ' : ' : ': ';
  const line = (label, value) => {
    if (value) lines.push(`${label[lang]}${separator}${value}`);
  };
  if (peer.loginExpired === true) lines.push(D.expiredHint[lang]);
  line(D.dns, peer.dnsLabel);
  line(D.os, peer.os);
  line(D.version, peer.version);
  const groups = (peer.groups ?? [])
    .map((g) => g.name)
    .filter(Boolean)
    .slice(0, 20)
    .join(', ');
  line(D.groups, groups);
  line(D.expires, loginExpiry(peer, account));
  return lines.length > 0 ? cut(lines.join('\n'), WIDGET_LIMITS.DESCRIPTION) : null;
}

/**
 * The instant of a last connection for the dashboard. An exact midnight UTC
 * would be read by the dashboard as a calendar day (no time, and shifted a
 * day west of Greenwich): one millisecond more keeps it an instant.
 */
export function instantOf(ms) {
  const iso = new Date(ms).toISOString();
  return iso.endsWith('T00:00:00.000Z') ? new Date(ms + 1).toISOString() : iso;
}

function itemOf(peer, context) {
  const item = {
    title: cut(peer.name, WIDGET_LIMITS.TITLE),
    badge: badgeOf(peer, context),
  };
  const subtitle = subtitleOf(peer);
  if (subtitle) item.subtitle = subtitle;
  if (peer.connected !== true && Number.isFinite(peer.lastSeen)) {
    item.date = instantOf(peer.lastSeen);
  }
  const description = descriptionOf(peer, context.account, context.lang);
  if (description) item.description = description;
  return item;
}

const text = (value, variant) => ({ type: 'text', text: value, variant });

/** The name of the Gladys device of a watched peer absent from the reading. */
function deviceName(gladys, externalId, peerId) {
  const device = (gladys?.devices ?? []).find((d) => d?.external_id === externalId);
  return typeof device?.name === 'string' && device.name.trim() ? device.name.trim() : peerId;
}

/**
 * The content of the widget.
 * @param {object} input
 * @param {'ok'|'paused'|'error'|'refused'|'config'|'waiting'} input.state
 * @param {object[]} input.peers the peers of the last reading (followed ones)
 * @param {number|null} input.readAt when they were read (ms); null: nothing
 *   was ever read for this server, filter and token
 * @param {object|null} input.account the account settings (login expiry)
 * @param {object} input.settings the raw settings of the widget instance
 * @param {string} input.language
 * @param {object} input.gladys for the external ids of the watched peers
 * @param {number} input.ttlSeconds
 */
export function peersWidget({
  state,
  peers = [],
  readAt = null,
  account = null,
  settings,
  language,
  gladys,
  ttlSeconds = 60,
}) {
  const lang = languageOf(language);
  const options = widgetSettings(gladys, settings);
  const ttl_seconds = Math.min(3600, Math.max(10, Math.round(ttlSeconds)));
  const statusItems = [
    {
      label: T.widget.status.label[lang],
      value: T.widget.status[state]?.[lang] ?? T.widget.status.error[lang],
      icon: 'activity',
      color: STATE_COLORS[state] ?? WIDGET_COLORS.DANGER,
    },
  ];

  // Nothing to show: a refused token or a configuration to fix hides the
  // peers; any other state shows the last reading, if there was one.
  const read = readAt !== null || (state === 'ok' && peers.length > 0);
  if (ALWAYS_EMPTY.includes(state) || !read) {
    const message =
      state === 'ok' ? T.widget.empty.all : (T.widget.empty[state] ?? T.widget.empty.error);
    return {
      ttl_seconds,
      components: [text(message[lang], 'body'), { type: 'status', items: statusItems }],
    };
  }

  const scoped = peers.filter((peer) => matchesFilter(options.groups, peer));
  const connected = scoped.filter((p) => p.connected === true);
  const disconnected = scoped.filter((p) => p.connected === false);
  const unknown = scoped.filter((p) => p.connected !== true && p.connected !== false);
  const expired = scoped.filter((p) => p.loginExpired === true);
  const watchedOffline = sortPeers(
    scoped.filter((p) => options.watch.has(p.id) && p.connected === false),
  );
  const present = new Set(peers.map((p) => p.id));
  const watchedMissing = [...options.watch]
    .filter(([peerId]) => !present.has(peerId))
    .map(([peerId, externalId]) => deviceName(gladys, externalId, peerId));
  const stale = state !== 'ok';
  const staleColor = STATE_COLORS[state] ?? WIDGET_COLORS.DANGER;
  const tile = (label, value, icon, color) => ({
    type: 'value',
    label: label[lang],
    value,
    icon,
    color: stale ? staleColor : color,
  });
  const components = [
    tile(
      T.widget.tiles.connected,
      connected.length,
      'check-circle',
      connected.length > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    ),
    tile(
      T.widget.tiles.disconnected,
      disconnected.length,
      'wifi-off',
      watchedOffline.length > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    ),
    tile(T.widget.tiles.total, scoped.length, 'globe', WIDGET_COLORS.PRIMARY),
  ];
  if (unknown.length > 0) {
    components.push(
      tile(T.widget.tiles.unknown, unknown.length, 'help-circle', WIDGET_COLORS.NEUTRAL),
    );
  }
  if (expired.length > 0) {
    components.push(tile(T.widget.tiles.expired, expired.length, 'clock', WIDGET_COLORS.WARNING));
  }

  const view = sortPeers(
    scoped.filter((p) =>
      options.filter === 'connected'
        ? p.connected === true
        : options.filter === 'disconnected'
          ? p.connected === false
          : true,
    ),
  );
  const start = (options.page - 1) * options.maxItems;
  const rows = view.slice(start, start + options.maxItems);
  const left = Math.max(0, view.length - start - rows.length);
  if (rows.length > 0) {
    const context = { watch: options.watch, account, lang, stale };
    components.push({
      type: 'card-list',
      display: 'list',
      items: rows.map((p) => itemOf(p, context)),
    });
  } else {
    const message =
      view.length > 0
        ? T.widget.empty.page(options.page, view.length)
        : scoped.length === 0
          ? T.widget.empty.all
          : T.widget.empty[options.filter];
    components.push(text(message[lang], 'body'));
  }

  if (readAt !== null) {
    statusItems.push({
      label: T.widget.status.readAt[lang],
      value: formatDate(readAt),
      icon: 'clock',
      color: stale ? staleColor : WIDGET_COLORS.NEUTRAL,
    });
  }
  const watchedItems = [
    ...watchedOffline.map((peer) => [T.widget.status.watched, peer.name]),
    ...watchedMissing.map((name) => [T.widget.status.missing, name]),
  ];
  for (const [label, name] of watchedItems.slice(0, WIDGET_LIMITS.WATCHED_IN_STATUS)) {
    statusItems.push({
      label: label[lang],
      value: cut(name, WIDGET_LIMITS.STATUS_TEXT),
      icon: 'alert-triangle',
      color: WIDGET_COLORS.DANGER,
    });
  }
  components.push({ type: 'status', items: statusItems.slice(0, WIDGET_LIMITS.STATUS_ITEMS) });

  if (rows.length > 0 && (left > 0 || options.page > 1)) {
    const parts = [];
    if (options.page > 1) parts.push(T.widget.page(options.page)[lang]);
    if (left > 0) parts.push(T.widget.more(left)[lang]);
    components.push(text(cut(parts.join(' · '), WIDGET_LIMITS.CAPTION), 'caption'));
  }
  return { ttl_seconds, components };
}
