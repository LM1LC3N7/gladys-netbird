# NetBird

Les pairs de votre réseau [NetBird](https://netbird.io) dans Gladys, par
l'API REST de son serveur de gestion (NetBird Cloud ou votre propre
serveur) :

- chaque pair devient un appareil Gladys : **connecté**, **dernière vue**,
  **IP NetBird**, **version du client**, **connexion expirée** et
  **expiration de la connexion** (la date de fin de sa session de
  connexion) ;
- le réseau devient un appareil avec ses **pairs connectés** et ses
  **pairs** au total ;
- trois déclencheurs de scène : **Pair connecté**, **Pair déconnecté** et
  **Connexion d'un pair expirée**.

Lecture seule : Gladys ne change jamais rien dans NetBird (aucun pair
supprimé, aucune règle ni aucun groupe modifié).

> **Cette intégration n'a jamais été testée avec un vrai compte NetBird.**
> Cette première version a été écrite d'après la référence publique de l'API
> NetBird (docs.netbird.io/api) et testée seulement contre un faux NetBird.
> Dites sur le forum Gladys ce qui marche et ce qui ne marche pas.

Intégration non officielle, sans lien avec NetBird.

## Avant de commencer : un jeton qui ne fait que lire

1. Dans le tableau de bord NetBird, ouvrez **Team → Service Users** et créez
   un utilisateur de service `gladys` au rôle **User** (un utilisateur de
   service n'est pas une personne : son jeton ne cesse pas de marcher quand
   quelqu'un part). Si votre offre n'a pas d'utilisateurs de service, prenez
   **Team → Users** et votre propre utilisateur.
2. Ouvrez l'utilisateur, **Create Token**, nommez-le `gladys`, choisissez une
   expiration et copiez le jeton (il commence par `nbp_`) : NetBird ne
   l'affiche qu'une fois.
3. Vérifiez que cet utilisateur voit tous les pairs : avec le rôle **User**,
   NetBird peut ne montrer à un utilisateur ordinaire que ses propres pairs
   (réglage du compte « Restrict regular users ») ; l'état de connexion de
   l'intégration le signale dans ce cas. Un jeton **Admin** voit tout, mais
   pourrait tout changer : Gladys ne fait que lire, mais un jeton aux droits
   réduits est plus sûr.
4. Les dates d'expiration des pairs (expiration de la connexion) viennent
   des réglages du compte, qu'un jeton User n'a peut-être pas le droit de
   lire : elles restent alors vides, le reste marche.

## Configuration

- **Serveur de gestion** : vide pour NetBird Cloud
  (`https://api.netbird.io`). Auto-hébergé : l'adresse https de votre
  serveur, celle du tableau de bord (`https://netbird.example.org` ; un port
  et un chemin sont gardés, un `/api` final est retiré). `http://` est
  refusé : le jeton traverserait le réseau en clair.
- **Jeton d'accès personnel** : gardé par Gladys dans sa base, jamais
  réaffiché, envoyé seulement au serveur de gestion NetBird, dans l'en-tête
  `Authorization: Token …` (jamais dans une adresse, jamais dans un journal,
  jamais dans le volume `/data`). Collez le jeton seul : une espace ou un
  caractère invisible copié avec lui est refusé avec un message clair.
- **Empreinte du certificat** (facultatif, auto-hébergé seulement) : par
  défaut le certificat du serveur doit venir d'une autorité reconnue
  (NetBird Cloud, Let's Encrypt). Un serveur avec son propre certificat :
  saisissez son empreinte SHA-256 ; ce certificat, et aucun autre, est alors
  accepté, vérifié avant l'envoi du jeton. Après un renouvellement,
  saisissez la nouvelle. Pour la lire : votre navigateur (cadenas,
  certificat, empreinte SHA-256) ou
  `openssl s_client -connect netbird.example.org:443 </dev/null | openssl x509 -noout -fingerprint -sha256`.
- **Groupes** (facultatif) : noms ou identifiants de groupes NetBird,
  séparés par des virgules. Seuls leurs pairs deviennent des appareils et
  sont comptés. Vide : tous les pairs que voit le jeton.
- **Rafraîchissement** : toutes les minutes (par défaut) à toutes les 10
  minutes. Une requête par lecture (les pairs), plus les réglages du compte
  une fois par heure.

Ouvrez ensuite l'onglet **Découverte** et créez les pairs et le réseau à
suivre. Seuls les appareils créés reçoivent leurs états.

## Ce que montre chaque fonction

- **Connecté** (1 / 0) : ce que NetBird dit du pair en ce moment. Rien n'est
  publié tant que NetBird ne le dit pas.
- **Dernière vue** : la dernière fois que le serveur de gestion a eu des
  nouvelles du pair, sous la forme `2026-10-17 08:00 UTC` (en UTC, le fuseau
  de NetBird).
- **IP NetBird** : l'adresse du pair dans le réseau NetBird (`100.x.y.z`).
  Son adresse publique n'est jamais lue dans Gladys.
- **Version du client** : la version du client NetBird du pair. L'API ne dit
  pas si une mise à jour existe : pas de fonction « mise à jour disponible »
  dans cette version.
- **Connexion expirée** (1 / 0) : la session de connexion du pair a expiré ;
  quelqu'un doit s'y reconnecter (`netbird up`). Seuls les pairs ajoutés par
  une connexion SSO expirent ; ceux ajoutés par une clé d'installation
  jamais.
- **Expiration de la connexion** : la date de fin de session (dernière
  connexion plus l'expiration du compte), `—` quand elle n'expire jamais,
  rien tant qu'elle ne peut pas être connue (un jeton qui ne peut pas lire
  les réglages du compte).
- **Pairs connectés / Pairs** (appareil réseau) : les comptes des pairs
  suivis (ceux du filtre de groupes, s'il y en a un).

## Déclencheurs de scène

- **Pair connecté** : un pair déconnecté est de nouveau connecté.
- **Pair déconnecté** : un pair connecté est déconnecté.
- **Connexion d'un pair expirée** : la session de connexion d'un pair vient
  d'expirer.

Chacun porte le pair (filtre : un pair, ou tous), son nom et son IP NetBird.
Ils partent à la lecture qui suit le changement (jusqu'à l'intervalle de
rafraîchissement plus tard), une fois par changement. Jamais à la première
lecture après un démarrage de l'intégration, ni à la première lecture après
une panne (quand NetBird n'a pas pu être lu, les changements entre-temps
sont inconnus). Un nouveau pair ne déclenche rien. 30 événements au plus par
lecture.

## Problèmes de connexion

- **Jeton refusé** (HTTP 401, ou 403 répondu par l'API NetBird sur
  l'utilisateur ou les pairs : faux, expiré, révoqué, ou sans le droit de
  lire les pairs) : Gladys s'arrête et ne réessaie pas seul, même après un
  redémarrage ou quand Gladys se reconnecte. Créez un nouveau jeton,
  collez-le et enregistrez la configuration : seul l'enregistrement
  réessaie. Une page 403 qui ne vient pas de l'API (un proxy ou un pare-feu
  devant elle) est réessayée normalement.
- **NetBird surchargé** (HTTP 429) ou **erreur serveur** (HTTP 5xx) : toutes
  les requêtes sont suspendues, tant que NetBird le demande (Retry-After)
  entre 1 minute et 6 heures, jamais moins que l'intervalle de
  rafraîchissement. La pause est gardée dans `/data` : un redémarrage, une
  reconnexion de Gladys ou une configuration enregistrée attendent aussi.
- **NetBird injoignable** (réseau, délai, certificat) : nouvel essai après
  l'intervalle de rafraîchissement (une minute au moins), puis le délai
  double jusqu'à 30 minutes ; les appareils apparaissent injoignables
  entre-temps. L'intégration n'abandonne jamais.
- **Certificat refusé ou changé** : rien n'est envoyé. Installez un
  certificat d'une autorité reconnue, ou saisissez (de nouveau) l'empreinte
  du serveur.
- **Tester la connexion** relit les pairs et indique combien sont
  connectés ; il ne réessaie jamais un jeton refusé et n'abrège jamais une
  pause.

## Limites

- Un compte NetBird par intégration ; 500 pairs au plus (resserrez le filtre
  de groupes au-delà).
- L'appareil réseau est unique par intégration (`network:main`) : diriger
  l'intégration vers un autre compte garde le même appareil.
- Lecture seule dans cette version : aucune commande (supprimer un pair,
  changer une règle).
- Pas testée avec NetBird Cloud ni avec un serveur auto-hébergé, ni avec les
  différents rôles de NetBird : voir TODO.md dans le dépôt.
