# gladys-netbird

[Gladys Assistant](https://gladysassistant.com) external integration for
**NetBird**: each peer of your NetBird network becomes a Gladys device
(connected, last seen, NetBird IP, client version, login expired and login
expiry), the network a device with its counts, and a peer that connects,
disconnects or whose login expires a scene trigger. Read only.
**Unofficial integration, not affiliated with NetBird. Never tested with a
real NetBird account yet.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (NetbirdApp)
                 ├─ src/netbird/client.js   REST management API (users/current, peers, accounts)
                 ├─ src/netbird/http.js     the only network access (node:https, fingerprint)
                 ├─ src/netbird/parse.js    answers -> plain objects, login expiry
                 ├─ src/netbird/errors.js   error codes, token refusal
                 ├─ src/budget.js           states per minute
                 ├─ src/store.js            /data: refusals, pauses
                 └─ src/devices.js          peers and network (pure)
```

- **Authentication**: a personal access token in the
  `Authorization: Token <PAT>` header, nothing else. HTTP 401 (or a 403 with
  a JSON body of the API) on `/api/users/current` or `/api/peers` is final:
  a salted HMAC of the address and token is kept in `/data`, nothing is sent
  again until the configuration is saved. HTTP 429 and 5xx pause every
  request (Retry-After, 1 min to 6 h, never under the poll interval, kept in
  `/data`); other failures retry from the poll interval, doubling to 30 min.
- **TLS**: strict by default; a self-hosted certificate is accepted only by
  a typed SHA-256 fingerprint, checked on the handshake before the request
  (and the token) is written. `http://` is refused.
- **Reading** (every 60 s by default): `GET /api/peers`, filtered by groups;
  `GET /api/accounts` once an hour for the login expiration (secondary: its
  failure never blocks the peers). External ids: `peer:<NetBird id>`,
  `network:main`. Texts are budgeted under 250 states/min; connected, login
  expired and counts always go.
- **Triggers**: `peer_connected`, `peer_disconnected`, `peer_login_expired`,
  compared with the previous reading only (none at start, none after a
  failure, none for a new peer).
- **Read only**: every set_value is refused; no command endpoint is called.

## Development

```bash
npm install
npm test                                        # node --test, no network (loopback only)
npm run lint && npm run format:check
npm run audit                                   # production dependencies
npm run cover                                   # regenerate cover.png
npx github:GladysAssistant/integration-store .  # store admission checks
```

The tests run against the SDK's fake Gladys and a fake NetBird
(`test/helpers/fakeNetbird.js`), plus loopback http / https servers for the
transport. No test touches a real NetBird or the Internet.

## Credits

- The [NetBird API reference](https://docs.netbird.io/api): the endpoints
  and fields used. No code of NetBird is used (see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- [prohand/gladys-tailscale](https://github.com/prohand/gladys-tailscale)
  (Apache-2.0): the idea of a device per machine of a mesh VPN.
- [gladys-portainer](https://github.com/LM1LC3N7/gladys-portainer): the
  structure of the app, the retry policy and the certificate fingerprint.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
