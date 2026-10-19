// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, button, errors). Errors
// thrown to Gladys are English (one language per message, like the core's);
// the statuses and button answers are { en, fr }.
// -----------------------------------------------------------------------------

import { CODES } from './netbird/errors.js';

const plural = (n, one, many) => (n === 1 ? one : many);
/** French: 0 and 1 take the singular ("0 pair connecté"). */
const pluralFr = (n, one, many) => (n <= 1 ? one : many);

/** The token sees only the peers its user owns (User role, or restricted). */
const OWN_PEERS_ONLY = {
  en: 'The user of the token lists only its own peers (User role, or the dashboard of regular users restricted: then none): use the token of a service user with the Auditor role (or User) to see them all.',
  fr: 'L’utilisateur du jeton ne liste que ses propres pairs (rôle User, ou tableau de bord des utilisateurs ordinaires restreint : aucun alors) : utilisez le jeton d’un utilisateur de service au rôle Auditor (ou User) pour les voir tous.',
};
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));

/** Why NetBird failed, in a few words. */
export function reasonOf(err) {
  switch (err?.code) {
    case CODES.UNREACHABLE:
      return { en: 'no connection', fr: 'pas de connexion' };
    case CODES.TIMEOUT:
      return { en: 'no answer in time', fr: 'pas de réponse à temps' };
    case CODES.HTTP:
      return { en: `HTTP error ${err.status}`, fr: `erreur HTTP ${err.status}` };
    case CODES.BAD_ANSWER:
      return { en: 'unexpected answer', fr: 'réponse inattendue' };
    case CODES.TOO_LARGE:
      return { en: 'answer too large', fr: 'réponse trop grande' };
    case CODES.TLS_UNTRUSTED:
      return { en: 'certificate not trusted', fr: 'certificat non reconnu' };
    case CODES.TLS_CHANGED:
      return { en: 'certificate changed', fr: 'certificat changé' };
    case CODES.CLOSED:
      return { en: 'configuration changed', fr: 'configuration changée' };
    default:
      return { en: 'error', fr: 'erreur' };
  }
}

const RETRY = (delay) => ({
  en: `Retried in ${minutes(delay)} min.`,
  fr: `Nouvel essai dans ${minutes(delay)} min.`,
});

const join = (...parts) => ({
  en: parts
    .map((p) => p.en)
    .filter(Boolean)
    .join(' '),
  fr: parts
    .map((p) => p.fr)
    .filter(Boolean)
    .join(' '),
});

export const T = {
  status: {
    ok: ({ total, connected, ownPeersOnly, capped, filtered }) =>
      join(
        {
          en: `NetBird answers: ${connected} of ${total} ${plural(total, 'peer', 'peers')} connected${filtered ? ' (groups of the filter)' : ''}.`,
          fr: `NetBird répond : ${connected} ${pluralFr(connected, 'pair connecté', 'pairs connectés')} sur ${total}${filtered ? ' (groupes du filtre)' : ''}.`,
        },
        ownPeersOnly ? OWN_PEERS_ONLY : {},
        capped > 0
          ? {
              en: `${capped} more ${plural(capped, 'peer is', 'peers are')} left out (500 at most): narrow the group filter.`,
              fr: `${capped} ${pluralFr(capped, 'autre pair est ignoré', 'autres pairs sont ignorés')} (500 au plus) : resserrez le filtre de groupes.`,
            }
          : {},
      ),
    noPeer: ({ filtered, ownPeersOnly }) =>
      join(
        filtered
          ? {
              en: 'NetBird answers, but no peer is in the groups of the filter: check their names (or ids).',
              fr: 'NetBird répond, mais aucun pair n’est dans les groupes du filtre : vérifiez leurs noms (ou identifiants).',
            }
          : {
              en: 'NetBird answers, but the token sees no peer.',
              fr: 'NetBird répond, mais le jeton ne voit aucun pair.',
            },
        ownPeersOnly
          ? OWN_PEERS_ONLY
          : {
              en: 'If this is the personal token of a user with the User role, it lists only that user’s peers (none when the dashboard of regular users is restricted): take the token of a service user instead (Auditor or User role).',
              fr: 'Si c’est le jeton personnel d’un utilisateur au rôle User, il ne liste que ses pairs (aucun quand le tableau de bord des utilisateurs ordinaires est restreint) : prenez le jeton d’un utilisateur de service (Auditor ou User).',
            },
      ),
    urlInvalid: {
      en: 'The address of the management server is not valid: leave it empty for NetBird Cloud, or type https://netbird.example.org of your own server, without a query.',
      fr: 'L’adresse du serveur de gestion n’est pas valide : laissez-la vide pour NetBird Cloud, ou saisissez https://netbird.example.org de votre serveur, sans paramètres.',
    },
    urlHttp: {
      en: 'The address uses http://: the token would cross the network in clear. Use the https address of the management server.',
      fr: 'L’adresse utilise http:// : le jeton traverserait le réseau en clair. Utilisez l’adresse https du serveur de gestion.',
    },
    urlCredentials: {
      en: 'Remove the user name and password from the address: Gladys uses a personal access token.',
      fr: 'Retirez l’identifiant et le mot de passe de l’adresse : Gladys utilise un jeton d’accès personnel.',
    },
    missingToken: {
      en: 'Type a personal access token of NetBird (Team, Users or Service Users, the user, Create Token).',
      fr: 'Saisissez un jeton d’accès personnel NetBird (Team, Users ou Service Users, l’utilisateur, Create Token).',
    },
    tokenInvalid: {
      en: 'The access token holds a space or an invisible character (copied with it?): paste it again, only the token (it starts with nbp_).',
      fr: 'Le jeton d’accès contient une espace ou un caractère invisible (copié avec ?) : collez-le de nouveau, le jeton seul (il commence par nbp_).',
    },
    fingerprintInvalid: {
      en: 'The certificate fingerprint must be a SHA-256 fingerprint: 64 hexadecimal digits, colons allowed.',
      fr: 'L’empreinte du certificat doit être une empreinte SHA-256 : 64 chiffres hexadécimaux, deux-points permis.',
    },
    tokenRefused: {
      en: 'NetBird refused the access token on the list of the peers (HTTP 401 or 403: wrong, expired, revoked, or without the right to list peers). Gladys does not try again by itself: create a new token (a service user with the Auditor role), paste it and save the configuration.',
      fr: 'NetBird a refusé le jeton d’accès sur la liste des pairs (HTTP 401 ou 403 : faux, expiré, révoqué, ou sans le droit de lister les pairs). Gladys ne réessaie pas seul : créez un nouveau jeton (un utilisateur de service au rôle Auditor), collez-le et enregistrez la configuration.',
    },
    tlsUntrusted: (delay) =>
      join(
        {
          en: 'The certificate of the management server is not trusted (self-signed?): install a certificate from a known authority, or type its SHA-256 fingerprint.',
          fr: 'Le certificat du serveur de gestion n’est pas reconnu (auto-signé ?) : installez un certificat d’une autorité reconnue, ou saisissez son empreinte SHA-256.',
        },
        RETRY(delay),
      ),
    tlsChanged: (delay) =>
      join(
        {
          en: 'The certificate of the management server is not the one of the typed fingerprint: nothing was sent. If you renewed it, type the new fingerprint; otherwise another machine may be impersonating the server.',
          fr: 'Le certificat du serveur de gestion n’est pas celui de l’empreinte saisie : rien n’a été envoyé. Si vous l’avez renouvelé, saisissez la nouvelle empreinte ; sinon une autre machine se fait peut-être passer pour le serveur.',
        },
        RETRY(delay),
      ),
    notNetbird: (delay) =>
      join(
        {
          en: 'This address does not answer like the NetBird management API: check the address (the one of the dashboard, without /api) and the port.',
          fr: 'Cette adresse ne répond pas comme l’API de gestion NetBird : vérifiez l’adresse (celle du tableau de bord, sans /api) et le port.',
        },
        RETRY(delay),
      ),
    forbidden: (delay) =>
      join(
        {
          en: 'Something in front of NetBird refuses the request (HTTP 403 that is not an answer of the API: proxy, firewall).',
          fr: 'Quelque chose devant NetBird refuse la requête (HTTP 403 qui n’est pas une réponse de l’API : proxy, pare-feu).',
        },
        RETRY(delay),
      ),
    busy: (delay) =>
      join(
        {
          en: 'NetBird asks Gladys to slow down (HTTP 429): every request is paused.',
          fr: 'NetBird demande à Gladys de ralentir (HTTP 429) : toutes les requêtes sont suspendues.',
        },
        RETRY(delay),
      ),
    serverError: (status, delay) =>
      join(
        {
          en: `NetBird answers with a server error (HTTP ${status}): every request is paused.`,
          fr: `NetBird répond par une erreur serveur (HTTP ${status}) : toutes les requêtes sont suspendues.`,
        },
        RETRY(delay),
      ),
    paused: (delay) =>
      join(
        {
          en: 'NetBird asked Gladys to wait (HTTP 429 or a server error): the pause goes on.',
          fr: 'NetBird a demandé à Gladys d’attendre (HTTP 429 ou erreur serveur) : la pause continue.',
        },
        RETRY(delay),
      ),
    unreachable: (err, delay) =>
      join(
        { en: 'NetBird does not answer:', fr: 'NetBird ne répond pas :' },
        reasonOf(err),
        { en: '—', fr: '—' },
        RETRY(delay),
      ),
  },
  test: {
    ok: ({ total, connected }) => ({
      en: `Connected: ${connected} of ${total} ${plural(total, 'peer', 'peers')} connected. Add them from the Discovery tab.`,
      fr: `Connecté : ${connected} ${pluralFr(connected, 'pair connecté', 'pairs connectés')} sur ${total}. Ajoutez-les depuis l’onglet Découverte.`,
    }),
  },
  widget: {
    tiles: {
      connected: { en: 'Connected', fr: 'Connectés' },
      disconnected: { en: 'Disconnected', fr: 'Déconnectés' },
      total: { en: 'Total', fr: 'Total' },
      unknown: { en: 'Unknown', fr: 'Inconnus' },
      expired: { en: 'Login expired', fr: 'Connexion expirée' },
    },
    badges: {
      online: { en: 'online', fr: 'en ligne' },
      offline: { en: 'offline', fr: 'hors ligne' },
      unknown: { en: 'unknown', fr: 'inconnu' },
      // 16 characters at most: "connexion expirée" does not fit.
      expired: { en: 'login expired', fr: 'conn. expirée' },
    },
    status: {
      label: { en: 'NetBird', fr: 'NetBird' },
      ok: { en: 'answers', fr: 'répond' },
      paused: { en: 'paused (HTTP 429 or 5xx)', fr: 'en pause (HTTP 429 ou 5xx)' },
      error: { en: 'no answer', fr: 'sans réponse' },
      refused: { en: 'token refused', fr: 'jeton refusé' },
      config: { en: 'configuration to fix', fr: 'configuration à corriger' },
      waiting: { en: 'first reading pending', fr: 'première lecture en attente' },
      readAt: { en: 'Last reading', fr: 'Dernière lecture' },
      watched: { en: 'Watched, offline', fr: 'Surveillé, hors ligne' },
      missing: { en: 'Watched, not found', fr: 'Surveillé, introuvable' },
    },
    empty: {
      refused: {
        en: 'NetBird refused the access token: nothing to show. Paste a new token in the configuration of the integration and save it.',
        fr: 'NetBird a refusé le jeton d’accès : rien à afficher. Collez un nouveau jeton dans la configuration de l’intégration et enregistrez-la.',
      },
      config: {
        en: 'The integration is not configured, or its configuration is not valid: see its connection status.',
        fr: 'L’intégration n’est pas configurée, ou sa configuration n’est pas valide : voyez son statut de connexion.',
      },
      waiting: {
        en: 'NetBird has not been read yet: the peers appear after the first reading.',
        fr: 'NetBird n’a pas encore été lu : les clients apparaissent après la première lecture.',
      },
      error: {
        en: 'NetBird does not answer and no peer has been read yet: see the connection status of the integration.',
        fr: 'NetBird ne répond pas et aucun client n’a encore été lu : voyez le statut de connexion de l’intégration.',
      },
      all: {
        en: 'NetBird answers, but no peer is in this view (groups of the widget or of the integration).',
        fr: 'NetBird répond, mais aucun client n’est dans cette vue (groupes du widget ou de l’intégration).',
      },
      allStale: {
        en: 'No peer in this view (last reading).',
        fr: 'Aucun client dans cette vue (dernière lecture).',
      },
      connected: { en: 'No peer connected.', fr: 'Aucun client connecté.' },
      disconnected: { en: 'No peer disconnected.', fr: 'Aucun client déconnecté.' },
      page: (page, count) => ({
        en: `Page ${page} is empty: ${count} ${plural(count, 'peer', 'peers')} in this view.`,
        fr: `La page ${page} est vide : ${count} ${pluralFr(count, 'client', 'clients')} dans cette vue.`,
      }),
    },
    more: (n) => ({
      en: `+${n} more`,
      fr: `+${n} ${pluralFr(n, 'autre', 'autres')}`,
    }),
    page: (page) => ({ en: `Page ${page}`, fr: `Page ${page}` }),
    details: {
      os: { en: 'System', fr: 'Système' },
      version: { en: 'NetBird version', fr: 'Version NetBird' },
      dns: { en: 'DNS name', fr: 'Nom DNS' },
      groups: { en: 'Groups', fr: 'Groupes' },
      expires: { en: 'Login expires', fr: 'Expiration de la connexion' },
      expiredHint: {
        en: 'Login expired: log in again on this peer (netbird up).',
        fr: 'Connexion expirée : reconnectez ce client (netbird up).',
      },
    },
  },
  errors: {
    readOnly: 'This integration only reads NetBird: nothing can be changed from Gladys',
    notConnected: 'NetBird is not connected: see the configuration of the integration',
    testTooLong:
      'NetBird has not answered yet: see the connection status in a moment (nothing else to do)',
  },
};
