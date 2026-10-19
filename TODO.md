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
- [x] **Review corrections** (2026-10-17, review checked against
      netbirdio/netbird main and docs.netbird.io): `/api/users/current` is
      optional (403 for every service user: GetCurrentUserInfo), only
      `/api/peers` decides a refusal, and only with the NetBird envelope
      `{ message, code === status }`; Auditor service user recommended, User
      otherwise, never Admin (approval round 1: a service user reads
      everything whatever its role; only the personal token of a regular
      User lists its own peers, none when the dashboard of regular users is
      restricted), hint from `permissions.modules.peers.read` /
      `role` / `is_restricted`, also with no peer; every state within the
      budget (counts > connected > login expired > texts in turn, a failed
      publication counted); the capped end of a pause written back, the
      pause removed after a reading that works; `onDeviceUpdated` (forgets
      only that device); one reading at a time; badges `unreachable` on a
      refused token or an invalid configuration; http refused in the
      transport itself; more TLS error codes; `socket.on('error')`;
      user-agent `gladys-netbird/<version>`; more invisible characters;
      `app.netbird.io` read as `api.netbird.io`; docs (last seen, users
      endpoint, re-registered peer, counts beyond 500); French singular for 0.
- [x] **Dashboard widget** (2026-10-20, after 0.1.1, Louis's request):
      widget `peers` ("NetBird peers" / "Clients NetBird"): tiles, a
      card-list of the peers, a status, "+N more"; settings filter, groups,
      peers to watch, rows shown, page. Tested against the SDK's fake
      Gladys and `validateWidgetContent`; **never seen on a real Gladys
      dashboard**.
- [ ] **Milestone 2 — real NetBird** (a tester with NetBird Cloud and one
      with a self-hosted server): record real answers as fixtures (token and
      personal data removed), fix what differs. To check first:
  - the exact error bodies and statuses of the API: 401 for a wrong /
    expired / revoked PAT everywhere?; whether the Auditor role can be
    given to a service user (NetBird Cloud and self-hosted), and what it
    gets on `/api/peers` and `/api/accounts`; what a User-role token gets
    on `/api/peers` (its own peers, an empty list when the dashboard of
    regular users is restricted: as read in the source); the 403 of
    `/api/users/current` for a service user (read in the source);
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
- **Token refusal** (review, blocking): HTTP 401 on `/api/peers`, or a 403
  there carrying the NetBird error envelope (`message` a string, `code`
  equal to the status; any other 403 body, such as the HTML page of a
  proxy, a WAF or Cloudflare, is transient and retried, lesson of wave 1).
  `/api/users/current` never decides: NetBird answers PermissionDenied (403)
  to every service user there, so 401 / 403 / 404 / 405 give "user
  unknown" and the peers decide; 429 / 5xx there pause like any reading.
  Final: a salted HMAC-SHA-256 of the address and token (random salt
  generated once in `/data`) is kept; restarts, reconnections to Gladys and
  "Test the connection" send nothing; only saving the configuration tries
  again (brief). The badges turn `unreachable`.
- **Recommended token** (review, corrected at approval round 1): a service
  user with the **Auditor** role (reads everything, changes nothing), the
  **User** role otherwise, **never Admin** (read only: no right to change
  anything is needed). Rule of NetBird
  (`management/server/permissions/manager.go`, `ValidateUserPermissions`):
  `if operation == operations.Read && user.IsServiceUser { return true }`:
  a service user reads every peer and the account settings whatever its
  role. Should NetBird drop that rule one day, a service user with the
  User role would list nothing: hence the preference for Auditor, whose
  role grants the reads itself. Only the personal token of a regular user
  with the User role lists just the peers that user owns (none when the
  dashboard of regular users is restricted). When the user is readable (a
  regular user), `ownPeersOnly` = `permissions.modules.peers.read` when it
  is a boolean, else `is_restricted` or role `user`: said in the status,
  with or without peers; an empty list with an unknown user (a service
  user) gets the advice about personal User tokens.
- **Pauses**: HTTP 429 pauses every path for its Retry-After, bounded
  max(1 min, poll interval) to 6 h; 5xx pauses for the back-off delay (or a
  longer Retry-After, up to 6 h). Both are persisted in `/data` per server
  address and capped when read back (now + 6 h); the capped end is written
  back, and the entry is removed after a reading that works. Prudent choice: unlike
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
- **Address**: empty = NetBird Cloud `https://api.netbird.io` (the dashboard
  `app.netbird.io` typed on port 443 is read as it); a bare host is https;
  the transport refuses anything but https by itself (plain http only with
  `allowHttp`, set by the loopback tests alone); a path is kept and a trailing `/api` dropped; credentials, query
  and fragment refused.
- **Privacy**: only what Gladys shows is kept: no public IP
  (`connection_ip`), no e-mail, no user name, no city or country, no
  serial number; the user of the token gives only its role, `is_restricted`
  and `permissions.modules.peers.read` (said in the status when the token
  lists only its own peers).
- **Transport badge**: `cloud` (the management server is reached over the
  Internet for NetBird Cloud; kept for self-hosted too) when NetBird
  answers and the peer is in the reading, `unreachable` otherwise (a peer
  deleted in NetBird or out of the filter gets no state and the
  `unreachable` badge). A disconnected peer stays `cloud`: its data is read.
- **Rate of states** (review): POST /state admits 300 states/min; the
  integration keeps a sliding window under 250 for EVERY state. Only the
  values that changed (own memory of what Gladys accepted, forgotten per
  device when it is created, updated or deleted) are counted, by priority:
  counts, connected, login expired, then the texts, which take turns
  (rotating start) when cut. A failed publication still counts in the
  window. 200 created peers start over a few minutes (tested). Badges in
  calls of 100. One reading at a time: the loop and Discovery share the
  one in flight.
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
- **Widget `peers`** (2026-10-20):
  - `gladys_version` stays `>=5.1.0`: the store requires 5.1.0 for
    `widgets` (integration-store `constants.js`), and the widget code of
    the core (card-list with subtitle, date, badge, description; status;
    requestWidgetRefresh) is in the v5.1.0 tag. No action `fields` (5.2).
  - **Data**: only the last successful reading (`known`, with its time);
    `onWidgetGet` sends no request, so a 429 / 5xx pause is never skipped
    and the token refusal never retried from a dashboard. `ttl_seconds` =
    poll interval (60 to 600). `requestWidgetRefresh('peers')` when what
    the widget shows changes (state of NetBird, a peer connected /
    disconnected / expired / renamed / added / removed, its IP, DNS name,
    OS, version, groups, last seen of a disconnected peer, the account
    settings), never for the last seen of a connected peer (not shown).
    At most one nudge per 10 s (the core drops the next ones): a change
    held back is sent at the next check, the ttl covers it anyway; no
    timer of its own. The key is cleared at every `connected` (lesson of
    lot 6: the core cache may hold an older content).
  - **Content** (budget: 8 components, 1 focal, 6 tiles, 2 texts with 1
    body, 1 status): tiles connected / disconnected / total (always), login
    expired (only when > 0); card-list `display: list`, 8 rows at most,
    title = name (60), subtitle = NetBird IP · DNS name (60, the IP alone
    when both do not fit), date = last seen of a peer not connected, badge
    online (success) / offline (neutral, danger for a watched peer) /
    login expired (warning) / unknown (neutral), description = last seen,
    DNS name, OS, NetBird version, groups (20), login expiry; no link.
    Status: NetBird state, last reading, watched peers offline (6). Caption
    "+N more" (and "Page N").
  - **Sort**: connected first by name (no case), then the others (not
    connected, unknown included) by last seen, most recent first, unknown
    last, ties by name. The "connected" / "disconnected" filters keep that
    order (one group each); no reversed order.
  - **Settings**: `filter` (all / connected / disconnected; counts are not
    filtered), `groups` (same grammar as the configuration, within the
    followed peers), `watch` (multi_select, `source: devices`: "a peer that
    should be connected", the only way to know it), `max_items` (3 / 5 /
    8), `page` (number, 1 to 170: pagination by a second box, no button,
    so no `onWidgetAction`).
  - **Colors**: a watched peer offline turns the Disconnected tile and its
    badge `danger` and is named in the status; NetBird failing after a
    reading: tiles and status `danger` (`warning` during a pause), the
    last peers kept (IPs rarely change). Token refused, configuration to
    fix, nothing read yet: empty state (a body text and the status), no
    peer, no count. The handler never throws (a failure gives a text).
  - **Privacy**: the widget shows only what the module already keeps; two
    fields added to the parser for it, `os` and `dns_label` (validated as a
    host name), shown nowhere else. No public IP (`connection_ip`), no
    city / country, no user / e-mail even though the API gives them (the
    widget is on a dashboard any Gladys user may see); never the token nor
    the server address. Nothing new in the logs.
  - **Not done**: "update available" (no API field, see milestone 3);
    widget counts cover the 500 followed peers only.
