# Third-party notices

No third-party code is copied into this integration, and nothing but the
Gladys SDK is installed at runtime.

## NetBird

NetBird (<https://github.com/netbirdio/netbird>, BSD-3-Clause and AGPL-3.0
depending on its parts) is only talked to: this integration reads the
documented REST API of the NetBird management server
(<https://docs.netbird.io/api>: `/api/users/current`, `/api/peers`,
`/api/accounts`, the `Authorization: Token <PAT>` header). No line of
NetBird's own code is used, copied or adapted. NetBird is a trademark of its
owners; this integration is unofficial and not affiliated with them.

## prohand/gladys-tailscale

<https://github.com/prohand/gladys-tailscale> (Apache-2.0 declared in its
`package.json`; the repository ships no LICENSE file; read at commit
`40e15be`, 2026-10-14), a Gladys integration of the same field (the
machines of a mesh VPN): the idea of one Gladys device per machine keyed on
its stable id, and of scene triggers on connection changes. No code is
copied: the devices, features and triggers of this integration are its own.

## LM1LC3N7/gladys-portainer

The structure of the app (start queue, epochs of the loop, refusal kept as
a salted HMAC in `/data`, bounded pauses, state budget, transport badges),
the HTTP transport with a fingerprint checked before the request, and the
test helpers follow this integration of the same author, under the Apache
License 2.0 of this repository. The test certificates of
`test/fixtures/tls/` come from it (test material only).
