// -----------------------------------------------------------------------------
// Gladys devices (pure).
//
//   peer     `ext:<selector>:peer:<NetBird peer id>`
//            one per NetBird peer: connected and login expired (read only,
//            binary), last seen, NetBird IP, client version and login
//            expiry (texts)
//   network  `ext:<selector>:network:main`
//            the network of the configured account: peers connected, total
//
// The id NetBird gives a peer does not change when the peer is renamed or
// gets another IP: the external id uses it.
//
// A device published again never loses a feature: the core would mark it
// `structure_changed`, and "Update" would drop the history of the missing
// one. The features of the device created in Gladys (`gladys.devices`, kept
// up to date by the SDK) are added back when the blueprint lacks them.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { FEATURES, NETWORK_ID, NETWORK_TYPE, PEER_TYPE } from './constants.js';
import { ID_PATTERN } from './netbird/parse.js';

export const peerIds = (gladys, peerId) => gladys.externalIds(PEER_TYPE, peerId);
export const networkIds = (gladys) => gladys.externalIds(NETWORK_TYPE, NETWORK_ID);

const readOnly = (extra) => ({ read_only: true, has_feedback: false, ...extra });

// Never a switch: the core hands every switch to the voice assistants, MCP
// and the switch scene actions. Read-only `unknown`/`binary`.
const binary = (externalId, name) => ({
  name,
  external_id: externalId,
  ...readOnly({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 }),
  keep_history: true,
});

const text = (externalId, name) => ({
  name,
  external_id: externalId,
  ...readOnly({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0 }),
  keep_history: false,
});

/** The features of the created device the blueprint lacks, appended (never fewer). */
export function withCreatedFeatures(gladys, device, devices = gladys.devices) {
  const created = (devices ?? []).find((d) => d?.external_id === device.external_id);
  if (!created) return device;
  const known = new Set(device.features.map((f) => f.external_id));
  const extra = (created.features ?? []).filter(
    (f) => f && typeof f.external_id === 'string' && !known.has(f.external_id),
  );
  if (extra.length === 0) return device;
  return { ...device, features: [...device.features, ...extra] };
}

/** @param {{ id: string, name: string }} peer */
export function buildPeerDevice(gladys, peer) {
  const ids = peerIds(gladys, peer.id);
  return withCreatedFeatures(gladys, {
    name: peer.name,
    external_id: ids.device,
    model: 'NetBird peer',
    should_poll: false,
    features: [
      binary(ids.feature(FEATURES.CONNECTED), 'Connected'),
      text(ids.feature(FEATURES.LAST_SEEN), 'Last seen'),
      text(ids.feature(FEATURES.IP), 'NetBird IP'),
      text(ids.feature(FEATURES.VERSION), 'Client version'),
      binary(ids.feature(FEATURES.LOGIN_EXPIRED), 'Login expired'),
      text(ids.feature(FEATURES.LOGIN_EXPIRES), 'Login expires'),
    ],
  });
}

export function buildNetworkDevice(gladys) {
  const ids = networkIds(gladys);
  const counter = (key, name) => ({
    name,
    external_id: ids.feature(key),
    ...readOnly({ category: C.COUNTER_SENSOR, type: T.SENSOR.INTEGER, min: 0, max: 100_000 }),
    keep_history: true,
  });
  return withCreatedFeatures(gladys, {
    name: 'NetBird network',
    external_id: ids.device,
    model: 'NetBird network',
    should_poll: false,
    features: [
      counter(FEATURES.CONNECTED_COUNT, 'Peers connected'),
      counter(FEATURES.TOTAL_COUNT, 'Peers'),
    ],
  });
}

/**
 * What a device or feature external id of this integration designates:
 * { kind: 'peer', peerId, feature } | { kind: 'network', feature } | null.
 */
export function parseExternalId(gladys, externalId) {
  if (typeof externalId !== 'string') return null;
  const peerPrefix = gladys.externalId(`${PEER_TYPE}:`);
  if (externalId.startsWith(peerPrefix)) {
    const [id, feature, ...rest] = externalId.slice(peerPrefix.length).split(':');
    if (rest.length > 0 || !ID_PATTERN.test(id ?? '')) return null;
    return { kind: 'peer', peerId: id, feature: feature ?? null };
  }
  const networkPrefix = gladys.externalId(`${NETWORK_TYPE}:`);
  if (externalId.startsWith(networkPrefix)) {
    const [id, feature, ...rest] = externalId.slice(networkPrefix.length).split(':');
    if (rest.length > 0 || id !== NETWORK_ID) return null;
    return { kind: 'network', feature: feature ?? null };
  }
  return null;
}

/** The created devices of this integration: { peers: [...], network: entry | null }. */
export function createdDevices(gladys, devices = gladys.devices) {
  const peers = [];
  let network = null;
  for (const device of devices ?? []) {
    const parsed = parseExternalId(gladys, device?.external_id);
    if (!parsed || parsed.feature !== null) continue;
    const entry = { ...parsed, externalId: device.external_id };
    if (parsed.kind === 'peer') peers.push(entry);
    else network = entry;
  }
  return { peers, network };
}
