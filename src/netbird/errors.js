// -----------------------------------------------------------------------------
// NetbirdError: every failure of a request to NetBird, with a code the app
// maps to a status, a retry policy or a message. Messages never carry the
// access token.
// -----------------------------------------------------------------------------

export const CODES = Object.freeze({
  UNREACHABLE: 'unreachable', // no TCP connection
  TIMEOUT: 'timeout', // no answer in time
  TLS_UNTRUSTED: 'tls_untrusted', // certificate refused (self-signed, wrong name...)
  TLS_CHANGED: 'tls_changed', // differs from the typed fingerprint
  HTTP: 'http', // an HTTP status other than 2xx (see `status`)
  BAD_ANSWER: 'bad_answer', // not the JSON expected
  TOO_LARGE: 'too_large', // answer above the size cap
  CLOSED: 'closed', // the client was replaced (new configuration)
});

export class NetbirdError extends Error {
  constructor(code, message, { status, retryAfterMs, path, json } = {}) {
    super(message);
    this.name = 'NetbirdError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (retryAfterMs !== undefined && retryAfterMs !== null) this.retryAfterMs = retryAfterMs;
    if (path !== undefined) this.path = path;
    /** The error body was a JSON object (the API itself answered, not a proxy). */
    if (json !== undefined) this.json = json;
  }
}

/** The two requests whose refusal means "this token": the user, the peers. */
export const AUTH_PATHS = Object.freeze(['/api/users/current', '/api/peers']);

/**
 * The access token refused: HTTP 401 on `/api/users/current` or
 * `/api/peers`, or HTTP 403 answered there by the API itself (a JSON error
 * body; a 403 page of a proxy or a firewall in front of it is transient).
 * Final: never retried before the configuration is saved again.
 */
export const isTokenRefused = (err) =>
  err?.code === CODES.HTTP &&
  AUTH_PATHS.includes(err.path) &&
  (err.status === 401 || (err.status === 403 && err.json === true));
