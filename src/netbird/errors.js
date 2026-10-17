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
  constructor(code, message, { status, retryAfterMs, path, envelope } = {}) {
    super(message);
    this.name = 'NetbirdError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (retryAfterMs !== undefined && retryAfterMs !== null) this.retryAfterMs = retryAfterMs;
    if (path !== undefined) this.path = path;
    /** The error body was the envelope of the NetBird API: the API itself answered, not a proxy. */
    if (envelope !== undefined) this.envelope = envelope;
  }
}

/**
 * The error envelope of the NetBird management API:
 * `{ "message": "<text>", "code": <the HTTP status> }`.
 */
export function isNetbirdEnvelope(body, status) {
  try {
    const value = JSON.parse(body.toString('utf8'));
    return (
      Boolean(value) &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.message === 'string' &&
      value.code === status
    );
  } catch {
    return false;
  }
}

/**
 * The one request whose refusal means "this token": the list of the peers.
 * (`/api/users/current` answers 403 to every service user: never a refusal.)
 */
export const AUTH_PATHS = Object.freeze(['/api/peers']);

/**
 * The access token refused: HTTP 401 on `/api/peers`, or HTTP 403 answered
 * there by the API itself (its JSON envelope; a 403 page of a proxy or a
 * firewall in front of it is transient). Final: never retried before the
 * configuration is saved again.
 */
export const isTokenRefused = (err) =>
  err?.code === CODES.HTTP &&
  AUTH_PATHS.includes(err.path) &&
  (err.status === 401 || (err.status === 403 && err.envelope === true));
