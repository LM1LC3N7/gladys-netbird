# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Dashboard widget with connected and disconnected peers ("NetBird peers"):
  counts (connected, disconnected, total, login expired), a list of 8 rows
  at most with the name, NetBird IP and DNS name, an online / offline badge
  and the last connection of a disconnected peer, then "+N more"; settings
  for the peers listed (all, connected, disconnected), groups, peers to
  watch (red when offline or not found), rows shown and page. Built from
  the last reading, no request of its own; refreshed when a peer changes
  state. Peers without a state are counted apart as unknown; a reading
  with no peer shows zeros; a new token never shows the peers of the
  previous one.

## [0.1.1] - 2026-10-17

### Added

- First version, never tested with a real NetBird account: the peers of a
  NetBird network through the REST API of the management server (NetBird
  Cloud by default, or a self-hosted server) and a personal access token
  (`Authorization: Token` header). Read only.
- One device per peer, keyed on its NetBird id: connected and login expired
  (read only), last seen, NetBird IP, client version and login expiry
  (texts); one network device with the peers connected and in total.
- Scene triggers "Peer connected", "Peer disconnected" and "Peer login
  expired", never at the first reading nor after an outage.
- Optional filter by NetBird groups (names or ids); refresh every 1 to 10
  minutes (1 by default).
- Strict TLS by default; a self-hosted certificate accepted only by its typed
  SHA-256 fingerprint, checked before the token is sent; http:// refused.
- A refused token (HTTP 401, or a 403 of the API itself, on the list of the
  peers) stops everything until the configuration is saved (salted HMAC
  kept in `/data`, never the token); a service user token works (its 403 on
  `/api/users/current` is ignored); HTTP 429 and 5xx pause every request,
  bounded and kept in `/data`.
- Every state within 250 per minute (counts, connected, login expired, then
  the texts in turn); the status says when the token lists only its own
  peers, and advises a service user with the Auditor role.
- Button "Test the connection".

[Unreleased]: https://github.com/LM1LC3N7/gladys-netbird/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-netbird/releases/tag/v0.1.1
