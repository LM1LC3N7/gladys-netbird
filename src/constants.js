// -----------------------------------------------------------------------------
// Keys, limits and timings. The manifest keys, the trigger keys and the
// external id shapes are stored in user scenes and devices: never rename them
// (test/manifest.test.js ties them to the manifest).
// -----------------------------------------------------------------------------

export const ACTIONS = Object.freeze({
  TEST: 'test_connection',
});

export const SCENE_TRIGGERS = Object.freeze({
  PEER_CONNECTED: 'peer_connected',
  PEER_DISCONNECTED: 'peer_disconnected',
  LOGIN_EXPIRED: 'peer_login_expired',
});

/** Dashboard widgets (manifest `widgets`): the key is stored in user dashboards. */
export const WIDGETS = Object.freeze({
  PEERS: 'peers',
});

/** The settings of the peers widget (manifest `widgets[].settings`). */
export const WIDGET_FILTERS = Object.freeze(['all', 'connected', 'disconnected']);
export const WIDGET_MAX_ITEMS = Object.freeze(['3', '5', '8']);
export const WIDGET_DEFAULTS = Object.freeze({ filter: 'all', max_items: '8', page: 1 });
/** The core drops a refresh nudge sent less than 10 s after the previous one. */
export const WIDGET_REFRESH_MIN_MS = 10_000;

/** Device external ids: `ext:<selector>:peer:<NetBird peer id>`. */
export const PEER_TYPE = 'peer';
/** `ext:<selector>:network:main`: the one network of the configured account. */
export const NETWORK_TYPE = 'network';
export const NETWORK_ID = 'main';

export const FEATURES = Object.freeze({
  CONNECTED: 'connected',
  LAST_SEEN: 'last_seen',
  IP: 'ip',
  VERSION: 'version',
  LOGIN_EXPIRED: 'login_expired',
  LOGIN_EXPIRES: 'login_expires',
  CONNECTED_COUNT: 'connected_count',
  TOTAL_COUNT: 'total_count',
});

/** The management API of NetBird Cloud: the address used when none is typed. */
export const CLOUD_URL = 'https://api.netbird.io';

/** Seconds between two readings of the peers. */
export const POLL_INTERVALS = Object.freeze(['60', '120', '300', '600']);

/** Caps: what is read, published and fired. */
export const LIMITS = Object.freeze({
  PEERS: 500,
  /** Scene events sent in one reading (a whole site going down sends no flood). */
  EVENTS_PER_ROUND: 30,
  /**
   * POST /state admits 300 states per minute per integration: this
   * integration keeps under 250, the texts (last seen, IP, version, expiry)
   * being dropped first.
   */
  STATES_PER_MINUTE: 250,
  /** A text published to Gladys (a version, a name) is cut to this length. */
  TEXT_LENGTH: 100,
});

export const TIMEOUTS = Object.freeze({
  API: 15_000,
});

export const INTERVALS = Object.freeze({
  /** A failure (network, TLS, 5xx) is retried after max(this, the poll interval), doubling. */
  RETRY_MIN_MS: 60_000,
  RETRY_MAX_MS: 30 * 60_000,
  /** HTTP 429: pause of every request, within these bounds (Retry-After if given). */
  BUSY_MIN_MS: 60_000,
  BUSY_MAX_MS: 6 * 3600_000,
  /** The account settings (login expiration) are read again this often. */
  ACCOUNT_MS: 3600_000,
});

/** Size caps of the answers read from NetBird. */
export const MAX_BYTES = Object.freeze({
  PEERS: 8 * 1024 * 1024,
  ACCOUNT: 256 * 1024,
  USER: 256 * 1024,
});

/** The persistent store (refusals, pause: see src/store.js). */
export const STORE_FILE = 'netbird.json';
