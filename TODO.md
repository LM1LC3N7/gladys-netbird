# TODO — NetBird v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own: the claim is in /t/10385 (post #241, lot 6,
  NetBird added on 2026-10-17 at Louis's request).

## Status

- [x] **Milestone 1 — core** (2026-10-17): NetBird management API client
      (personal access token in `Authorization: Token`, `/api/users/current`,
      `/api/peers`, `/api/accounts`), NetBird Cloud by default or a
      self-hosted https server, strict TLS or a typed SHA-256 fingerprint
      checked before the token is written; one device per peer (connected,
      last seen, NetBird IP, client version, login expired, login expires)
      keyed by the NetBird peer id, one network device (connected / total);
      triggers `peer_connected`, `peer_disconnected`, `peer_login_expired`
      (none at the first reading, after a failure, for a new peer); group
      filter; poll 60 s by default; token refusal final and remembered
      (salted HMAC in `/data`), lifted only by saving the configuration;
      429 / 5xx pause bounded and persisted; status and Discovery sent again
      at every `connected`; a published device never loses a feature of the
      created one; read only; docs en/fr. Tested with unit tests against the
      SDK's fake Gladys, a fake NetBird (in memory and on loopback https) and
      loopback http / https servers. **Never tested with a real NetBird
      account.** No Docker on this PC: no e2e test in a container.
- [ ] **Milestone 2 — real NetBird** (a tester with NetBird Cloud and one
      with a self-hosted server): record real answers as fixtures (token and
      personal data removed), fix what differs. To check first:
  - the exact error bodies and statuses of the API: 401 for a wrong /
    expired / revoked PAT everywhere?; what a User-role token (service user
    or regular user) gets on `/api/peers` (403? only its own peers? an
    empty list when "Restrict regular users" is on?) and on `/api/accounts`
    (403?); whether `/api/users/current` works for a service user token;
  - does NetBird Cloud answer 429 (rate limit, Retry-After) and how often a
    reading every minute is fine; a WAF / Cloudflare 403 page in front of
    `api.netbird.io`?;
  - `last_seen` of a connected peer: updated continuously or only at
    status changes (the text would then rarely change);
  - `connected` and `login_expired` of a peer whose login expired (both at
    once? `connected` false first?), so the triggers do not double;
  - the login expiry: `last_login` + `peer_login_expiration` of the account
    is our computation, not a field of the API: compare with the dashboard;
    the inactivity expiration (`peer_inactivity_expiration`) is not shown;
  - `groups` in `/api/peers`: always present with `id` and `name`?;
  - pagination of `/api/peers` on large accounts (none documented);
  - self-hosted servers: the address users type (dashboard vs management
    port 33073 / 443, `/api` behind a reverse proxy), older versions
    without `/api/users/current` (handled as 404 / 405).
- [ ] **Milestone 3 — more**: "update available" (the API has no field: it
      would need the latest NetBird release, from GitHub, or
      `settings.auto_update_version` of the account), inactivity expiration,
      routes / exit nodes, several accounts. Commands stay out unless Louis
      asks (and then off by default, never a switch).
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public (the main session publishes),
      then the store validator once the image is published (at milestone 1
      its only error should be the `docker_image` not yet pullable from GHCR).

## Decisions

- **Duplicate check**: done by the main session (no NetBird module on
  GitHub, the store nor the forum on 2026-10-17); not repeated here.
- **Reuse**: no library: the NetBird API is plain REST and the client is
  small. NetBird itself (BSD-3 / AGPL-3.0) is never copied: only its
  documented API is used. prohand/gladys-tailscale (Apache-2.0) gave the
  idea of the devices and triggers (no code copied); the structure comes from
  LM1LC3N7/gladys-portainer (approved). `THIRD_PARTY_NOTICES.md` says so and
  is copied into the image with the standard Apache-2.0 `LICENSE` (copy of
  gladys-tedee's, no personal name).
- **Version**: 0.1.0 set by hand in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag
  (`ghcr.io/lm1lc3n7/gladys-netbird:0.1.0`); the first patch release gives
  0.1.1.
- **Read only in v1** (brief): no command at all, no scene action; every
  set_value is refused with a message and nothing is sent. No peer deletion,
  no rule, group or approval change, no login-expiration toggle.
- **External ids**: `peer:<NetBird peer id>` (the xid NetBird gives the
  peer, stable across renames and IP changes; checked against
  `[A-Za-z0-9_-]{1,64}`, never a `:`); `network:main`, one per integration,
  because the account id may be unreadable for a User-role token (a token
  of another account keeps the same network device: documented). Features
  `connected`, `last_seen`, `ip`, `version`, `login_expired`,
  `login_expires`, `connected_count`, `total_count`.
- **Feature types** (pairs of the core, no unit): connected and login
  expired `unknown`/`binary`, read only (never a switch: lesson of lot 6);
  last seen, IP, version and login expiry `text`/`text` (min 0, max 0, no
  history); counts `counter-sensor`/`integer`. Dates as
  `YYYY-MM-DD HH:MM UTC` (no time zone guess); a login that never expires
  is `—`; an unknown value is not published.
- **No "update available"**: the peer object of the API has only `version`
  (brief: "if the API gives it"); not invented from GitHub releases in v1.
- **Login expiry** = `last_login` + `settings.peer_login_expiration` of the
  account, when both the account and the peer have login expiration on
  (only SSO peers); `—` when either is off; nothing when the account cannot
  be read. `/api/accounts` is read at start and once an hour; its failure
  (403 for a regular user, anything) never blocks the peers and is never a
  token refusal; a 429 there pauses everything after the peers are
  published.
- **Token refusal**: HTTP 401 on `/api/users/current` or `/api/peers`, or a
  403 there whose body is a JSON object (the API itself; a 403 HTML page of
  a proxy, a WAF or Cloudflare is transient and retried, lesson of wave 1).
  Final: a salted HMAC-SHA-256 of the address and token (random salt
  generated once in `/data`) is kept; restarts, reconnections to Gladys and
  "Test the connection" send nothing; only saving the configuration tries
  again (brief). `/api/users/current` answering 404 / 405 (older server) is
  skipped.
- **Pauses**: HTTP 429 pauses every path for its Retry-After, bounded
  max(1 min, poll interval) to 6 h; 5xx pauses for the back-off delay (or a
  longer Retry-After, up to 6 h). Both are persisted in `/data` per server
  address and capped when read back (now + 6 h). Prudent choice: unlike
  gladys-portainer, saving the configuration does NOT lift a pause (it would
  let a user hammer a rate-limited API; the pause is bounded anyway). Other
  failures retry from max(1 min, poll interval), doubling up to 30 min;
  never a dead integration.
- **Reconnection to Gladys** (`connected`): the app restarts, the status and
  Discovery are sent again (the `lastStatus` / `discoveredKey` caches are
  cleared); refusals and pauses come from `/data`, so they hold; during a
  pause, Discovery is republished from the peers last read (kept in memory
  for the same server and filter). After a failed reading, the retry wait
  (deadline, next delay, status) is kept in memory for the same address and
  token (HMAC), so a reconnection never reads faster than the loop would
  (lesson learnt on gladys-portainer); "Test the connection" and a saved
  configuration read at once (never through a refusal nor a pause). The
  client is rebuilt: it holds no state (no token renewal with a PAT).
- **Never a smaller device**: the device published to Discovery always has
  every feature of its blueprint plus any feature of the created device in
  `gladys.devices` it lacks (lesson of lot 6).
- **TLS**: strict by default (`rejectUnauthorized`). Brief: "TLS strict or
  pinned fingerprint": a typed SHA-256 fingerprint must match exactly,
  decided on the handshake before the request. No trust on first use (the
  token would go to whoever answers first). `http://` refused outright
  (prudent: the PAT would cross the network in clear).
- **Address**: empty = NetBird Cloud `https://api.netbird.io`; a bare host is
  https; a path is kept and a trailing `/api` dropped; credentials, query
  and fragment refused.
- **Privacy**: only what Gladys shows is kept: no public IP
  (`connection_ip`), no e-mail, no user name, no city or country, no
  serial number; the user of the token gives only `is_restricted` (said in
  the status when the token sees only its own peers).
- **Transport badge**: `cloud` (the management server is reached over the
  Internet for NetBird Cloud; kept for self-hosted too) when NetBird
  answers and the peer is in the reading, `unreachable` otherwise (a peer
  deleted in NetBird or out of the filter gets no state and the
  `unreachable` badge). A disconnected peer stays `cloud`: its data is read.
- **Rate of states**: POST /state admits 300 states/min; the integration
  keeps a sliding window under 250. Connected, login expired and counts are
  change-only and always sent; texts are first reduced to those that
  changed, then cut to what is left of the window. Badges in calls of 100.
  Scene events: at most 30 per reading. Caps: 500 peers (the rest counted
  in the network device and said in the status).
- **Triggers**: compared with the previous successful reading only:
  `connected` false -> true fires `peer_connected`, true -> false fires
  `peer_disconnected`, `login_expired` false -> true fires
  `peer_login_expired`; an unknown value (null) never fires; the first
  reading after a start or a failure fires nothing; a new peer fires
  nothing. Data: `device` (the external id, for the filter), `peer_name`,
  `ip`.
- **Poll interval**: 60 s by default (brief), 120 / 300 / 600 offered. One
  request per reading, plus one per hour for the account.
- `gladys_version >=5.1.0` (scene triggers). `transports: ["cloud"]`.
