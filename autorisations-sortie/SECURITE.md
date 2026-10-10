# Sécurité de l'application « Autorisations de sortie »

Bilan de l'audit de sécurité. Chaque point ci-dessous est **vérifié par un test automatique** (`npm test` : 38 tests, dont 14 tests d'attaque dans `test/securite.test.js`).

## 1. Connexion et mots de passe

| Protection | Détail |
|---|---|
| Mots de passe chiffrés | Algorithme **scrypt** avec « sel » unique : même l'administrateur ou un pirate qui volerait la base ne peut pas les lire. |
| Mot de passe robuste obligatoire | 10 caractères minimum, avec majuscule, minuscule, chiffre et symbole. Il ne doit pas contenir l'identifiant. |
| Changement obligatoire | Tout mot de passe temporaire (création, réinitialisation, admin initial) doit être changé à la première connexion. |
| Contre les essais en série | Compte **verrouillé 15 min après 5 erreurs**, et limite de tentatives par appareil. |
| Pas d'indice pour un pirate | Même message, et même temps de réponse, que l'identifiant existe ou non. |
| Session protégée | Jeton aléatoire, stocké **chiffré** en base. Cookie `HttpOnly` (inaccessible aux scripts) et `SameSite=Strict`. `Secure` est activé en HTTPS. |
| Téléphone perdu | Admin → **Utilisateurs** → bouton **Déconnecter tous les appareils** (ou désactiver le compte). L'effet est immédiat. |

## 2. Droits : chacun ne voit que ce qui le concerne

| Rôle | Peut | Ne peut pas |
|---|---|---|
| **Gardien** | Vérifier un matricule ou un badge, enregistrer sortie et retour, voir son historique | Voir le **motif**, les commentaires, les pièces jointes, les listes du personnel ; créer ou annuler une autorisation |
| **Chef / responsable** | Autoriser le personnel **de son affectation**, voir ses autorisations | Voir le personnel ou les autorisations des autres affectations ; modifier les utilisateurs ou les paramètres |
| **RH** | Autoriser tout le personnel, historique, rapport Excel | Gérer les utilisateurs, les paramètres, le journal d'audit |
| **Administrateur** | Tout | Retirer ses propres droits (protection contre l'erreur) |

Les droits sont contrôlés **par le serveur** à chaque action. Modifier l'écran ou envoyer une requête à la main ne permet donc pas de les contourner.

## 3. Attaques web bloquées

| Attaque | Protection |
|---|---|
| Accès sans connexion | Toutes les données renvoient « Authentification requise ». |
| Faux formulaire depuis un autre site (CSRF) | En-tête applicatif obligatoire, vérification de l'origine, cookie `SameSite=Strict`. |
| Injection de code dans les pages (XSS) | Tout texte saisi est neutralisé à l'affichage. Une politique de sécurité (CSP) interdit les scripts externes ou intégrés. |
| Injection SQL | Toutes les requêtes à la base sont paramétrées. |
| Fichiers piégés | Photos et pièces jointes : seuls PDF, JPEG, PNG et WEBP sont acceptés, et le **contenu réel du fichier est vérifié**. Un faux PDF contenant du HTML est refusé. |
| Accès à d'autres fichiers du serveur | Noms de fichiers contrôlés : aucun accès à la base, au `.env` ou au code. |
| Formules piégées dans Excel / CSV | Les textes commençant par `=`, `+`, `-` ou `@` sont neutralisés. |
| Notifications détournées | Seuls les services officiels (Google, Apple, Mozilla, Microsoft) sont acceptés. |
| Affichage dans un cadre d'un autre site | Interdit (`X-Frame-Options: DENY`). |

## 4. Traçabilité

- **Journal d'audit infalsifiable**. Chaque action est enregistrée : qui, quand, quoi, valeurs avant et après, adresse IP. La base **interdit la modification et la suppression** du journal, et les entrées sont **chaînées par empreinte SHA-256**. Le bouton « Vérifier l'intégrité » détecte toute altération.
- **Rien n'est effacé en silence**. Un élément lié à l'historique (opérateur, utilisateur…) est désactivé au lieu d'être supprimé.

## 5. Composants externes

`npm audit` : **0 vulnérabilité connue**. Le sous-composant `uuid` a été forcé dans une version corrigée.

## 6. À faire lors de la mise en service

1. **Utiliser le HTTPS** (Render ou le script serveur le font automatiquement). Sans HTTPS, les mots de passe circulent en clair sur le Wi-Fi.
2. **Base vide en production** : les données de démonstration sont **refusées automatiquement** sur un serveur en production.
3. **Code de verrouillage** sur chaque téléphone, puisque l'application reste connectée en permanence (réglage « Jamais »).
4. **Désactiver immédiatement** le compte d'une personne qui quitte la société, ou utiliser « Déconnecter tous les appareils ».
5. **Sauvegarde hebdomadaire** téléchargée et conservée hors du serveur.
6. **Mettre à jour** l'application quand une nouvelle version est publiée.

## 7. Limites connues

| Point | Explication |
|---|---|
| Session « Jamais » | Choix voulu pour que les téléphones ne soient jamais suspendus. La sécurité repose alors sur le **verrouillage du téléphone** et sur la possibilité de couper l'accès à distance. On peut choisir une durée dans Paramètres. |
| Badge QR prêté | Le badge identifie la personne mais ne prouve pas qui le présente : ajouter les **photos** du personnel pour que le gardien compare. |
| Mode réseau local en `http://` | Acceptable pour un test. En production, préférez le HTTPS. |
