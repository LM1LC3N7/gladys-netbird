# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for NetBird: a Node.js service
(Node 22+, ESM, no build step) that runs in its own sandboxed Docker container
and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It reads the peers of a NetBird network through
the REST management API (NetBird Cloud or self-hosted), with a personal access
token. Read only. See `TODO.md` for the status and every decision.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "429"     # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # regenerate cover.png (plain Node)
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js)
src/handlers.js                   every SDK handler, registered before connect()
src/app.js                        NetbirdApp: start queue, loop, failures, states, triggers
src/netbird/client.js             GET /api/users/current, /api/peers, /api/accounts
src/netbird/http.js               the only network access (node:https, fingerprint pin)
src/netbird/parse.js              answers -> plain objects (no personal data kept)
src/netbird/errors.js             error codes; what a refused token is
src/devices.js                    peer and network devices (pure), never fewer features
src/config.js                     DEFAULTS (mirror the manifest) + normalization
src/store.js                      /data: refusal HMAC, salt, pauses
src/budget.js                     sliding window of the states sent per minute
src/i18n.js                       statuses and messages (en / fr)
gladys-assistant-integration.json manifest
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, fake Gladys (SDK) + fake NetBird
```

## Rules

- **External ids are forever**: `peer:<NetBird peer id>`, `network:main`, and
  the feature keys of `src/constants.js`. Changing one creates a new device
  and orphans the old one. The same goes for every key users store: manifest
  `config_schema`, `actions`, scene trigger keys and their fields.
- **Read only**: no request other than GET, no command. Adding one needs
  Louis's decision, off by default, never a switch.
- **The token** is sent only in the `Authorization` header; never in a URL,
  a log, an error message or `/data`.
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand (0.1.0 was set by hand once, before the first release).
  `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }` objects; the catalog
  `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code.
- **Encoding.** Files are UTF-8 without BOM; `test/encoding.test.js` refuses
  mojibake in the manifest, docs, README, CHANGELOG, TODO, CLAUDE.md, the
  notices and `src/**/*.js`. Write files with an editor, never through a
  shell that guesses a code page.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only).
