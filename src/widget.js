// -----------------------------------------------------------------------------
// The "peers" dashboard widget. Pure: it renders the last reading of the app
// (never a request of its own).
//
//   tiles    connected, disconnected, total (of the groups of the widget),
//            login expired when there is one
//   focal    a card-list (list, 8 rows at most): connected peers first by
//            name, then the disconnected ones, most recently seen first
//   status   how NetBird answers, when it was last read, the watched peers
//            that are offline
//   caption  "+N more" beyond the rows shown
//
// A refused token, a configuration to fix, or nothing read yet: an empty
// state (a text and the status), never an exception. An outage after a
// reading keeps the last peers read, with the status in danger (warning
// during a pause asked by NetBird): the NetBird IPs rarely change.
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
  /** Watched offline peers listed in the status (the rest are in the list). */
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
  waiting: WIDGET_COLORS.NEUTRAL,
};

/** 'fr' for a French dashboard, 'en' otherwise. */
export const languageOf = (language) =>
  typeof language === 'string' && language.toLowerCase().startsWith('fr') ? 'fr' : 'en';

const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/**
 * The settings of a widget instance (validated by the core against the
 * manifest, read again here: a dashboard may hold an older shape).
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
  const watch = new Set();
  for (const externalId of Array.isArray(settings.watch) ? settings.watch.slice(0, 50) : []) {
    const parsed = parseExternalId(gladys, externalId);
    if (parsed?.kind === 'peer' && parsed.feature === null) watch.add(parsed.peerId);
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

/** Connected peers first by name, then the others, most recently seen first. */
export function sortPeers(peers) {
  const connected = peers.filter((p) => p.connected === true).sort(byName);
  const others = peers
    .filter((p) => p.connected !== true)
    .sort((a, b) => (b.lastSeen ?? -Infinity) - (a.lastSeen ?? -Infinity) || byName(a, b));
  return [...connected, ...others];
}

function badgeOf(peer, watched, lang) {
  if (peer.loginExpired === true) {
    return { text: T.widget.badges.expired[lang], color: WIDGET_COLORS.WARNING };
  }
  if (peer.connected === true) {
    return { text: T.widget.badges.online[lang], color: WIDGET_COLORS.SUCCESS };
  }
  if (peer.connected === false) {
    return {
      text: T.widget.badges.offline[lang],
      color: watched ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
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

function descriptionOf(peer, account, lang) {
  const D = T.widget.details;
  const lines = [];
  const separator = lang === 'fr' ? ' : ' : ': ';
  const line = (label, value) => {
    if (value) lines.push(`${label[lang]}${separator}${value}`);
  };
  if (peer.loginExpired === true) lines.push(D.expiredHint[lang]);
  if (peer.connected !== true) line(D.lastSeen, formatDate(peer.lastSeen));
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

function itemOf(peer, { watch, account, lang }) {
  const item = {
    title: cut(peer.name, WIDGET_LIMITS.TITLE),
    badge: badgeOf(peer, watch.has(peer.id), lang),
  };
  const subtitle = subtitleOf(peer);
  if (subtitle) item.subtitle = subtitle;
  if (peer.connected !== true && Number.isFinite(peer.lastSeen)) {
    item.date = new Date(peer.lastSeen).toISOString();
  }
  const description = descriptionOf(peer, account, lang);
  if (description) item.description = description;
  return item;
}

const text = (value, variant) => ({ type: 'text', text: value, variant });

/**
 * The content of the widget.
 * @param {object} input
 * @param {'ok'|'paused'|'error'|'refused'|'config'|'waiting'} input.state
 * @param {object[]} input.peers the peers of the last reading (followed ones)
 * @param {number|null} input.readAt when they were read (ms)
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
  // peers (they may not be the ones of this token any more).
  const showPeers = !['refused', 'config'].includes(state) && peers.length > 0;
  if (!showPeers) {
    const message = T.widget.empty[state] ?? T.widget.empty.error;
    return {
      ttl_seconds,
      components: [text(message[lang], 'body'), { type: 'status', items: statusItems }],
    };
  }

  const scoped = peers.filter((peer) => matchesFilter(options.groups, peer));
  const connected = scoped.filter((p) => p.connected === true);
  const disconnected = scoped.filter((p) => p.connected === false);
  const expired = scoped.filter((p) => p.loginExpired === true);
  const watchedOffline = sortPeers(
    scoped.filter((p) => options.watch.has(p.id) && p.connected !== true),
  );
  const stale = state !== 'ok';
  const staleColor = state === 'paused' ? WIDGET_COLORS.WARNING : WIDGET_COLORS.DANGER;
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
  if (expired.length > 0) {
    components.push(tile(T.widget.tiles.expired, expired.length, 'clock', WIDGET_COLORS.WARNING));
  }

  const view = sortPeers(
    scoped.filter((p) =>
      options.filter === 'connected'
        ? p.connected === true
        : options.filter === 'disconnected'
          ? p.connected !== true
          : true,
    ),
  );
  const start = (options.page - 1) * options.maxItems;
  const rows = view.slice(start, start + options.maxItems);
  const left = Math.max(0, view.length - start - rows.length);
  if (rows.length > 0) {
    const context = { watch: options.watch, account, lang };
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
  for (const peer of watchedOffline.slice(0, WIDGET_LIMITS.WATCHED_IN_STATUS)) {
    statusItems.push({
      label: T.widget.status.watched[lang],
      value: cut(peer.name, WIDGET_LIMITS.STATUS_TEXT),
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
