# Autorisations de sortie — STE CONTACT

Application web pour gérer les autorisations de sortie des opérateurs et ouvriers. Elle remplace le papier : le **chef d'équipe** crée la demande, le **RH / responsable** la valide ou la refuse, et le **gardien** reçoit la validation immédiatement sur sa tablette. Il enregistre ensuite la sortie et le retour.

- Fonctionne **24 h/24 et 7 j/7**, pour les équipes en 3×8. Les horaires RH (08:00–17:00, pause 12:00–13:00) servent seulement d'information : ils ne bloquent jamais une opération.
- Le **poste 3 (23:00 → 07:00)** et les sorties qui passent minuit sont gérés correctement. Par exemple, une sortie le 05/10 de 23:30 à 01:00 reste valable jusqu'au 06/10 à 01:00.
- L'interface s'adapte à l'ordinateur, à la tablette et au smartphone. Elle peut aussi être installée comme une application (PWA).

## Tester sur votre PC (démonstration)

1. Installez **Node.js** (version LTS 22 ou plus) : https://nodejs.org
2. **Windows** : double-cliquez sur **`DEMARRER-DEMO.bat`**. **Mac / Linux** : lancez `./demarrer-demo.sh`.
3. Le navigateur s'ouvre sur http://localhost:3000. Connectez-vous avec un compte de démonstration (tableau plus bas).
4. Pour arrêter, fermez la fenêtre noire. Pour repartir de zéro, supprimez le dossier `data`.

> 📱 **Utilisation sur téléphones et tablettes dans la société** : suivez le guide pas à pas [INSTALLATION-RESEAU.md](INSTALLATION-RESEAU.md).

## Démarrage rapide

Il faut **Node.js 22.5 ou plus récent**. L'application n'a besoin d'aucun serveur de base de données : elle utilise SQLite, intégré à Node.

```bash
cd autorisations-sortie
npm install
npm run seed:demo   # facultatif : données de démonstration (41 opérateurs, 4 mois d'historique)
npm start           # http://localhost:3000
```

Au premier démarrage sans données de démonstration, un compte `admin` est créé. Son mot de passe temporaire s'affiche dans la console. Vous pouvez aussi le fixer avec `ADMIN_PASSWORD=...`. Le changement du mot de passe est exigé à la première connexion.

### Comptes de démonstration (`npm run seed:demo`)

| Identifiant | Mot de passe | Rôle |
|---|---|---|
| `admin` | `Admin@2026!` | Administrateur |
| `chef.karim` | `Demo@2026!` | Chef d'équipe — Équipe B (poste 23:00–07:00, opérateur 4587 BEN ALI Mohamed) |
| `chef.ahmed` | `Demo@2026!` | Chef d'équipe — Équipe A + Maintenance 1 |
| `chef.sami` | `Demo@2026!` | Chef d'équipe — Équipe C |
| `rh.leila`, `rh.nadia` | `Demo@2026!` | RH / Responsable |
| `gardien.ali`, `gardien.nabil` | `Demo@2026!` | Gardien (écran POSTE DE GARDE) |

> ⚠️ Ces mots de passe servent uniquement à la démonstration. En production, partez d'une base vide (sans `seed:demo`).

## Parcours (minimum de clics)

| Rôle | Parcours |
|---|---|
| Chef d'équipe | **Nouvelle autorisation** → rechercher le matricule (ou le nom) → remplir → **Envoyer** |
| RH | **Demandes en attente** → ouvrir → vérifier → **VALIDER / REFUSER** (motif obligatoire en cas de refus) |
| Gardien | Taper le matricule → 🟢 **AUTORISÉ** ou 🔴 **NON AUTORISÉ** → **VALIDER LA SORTIE** ; au retour → **RETOUR** |

**Deux types d'autorisation** :
- **Avec retour** : l'opérateur sort puis revient (heure de retour obligatoire). S'il dépasse l'heure prévue, il apparaît 🔴 en retard.
- **Sans retour** : l'opérateur quitte son poste (ex. maladie). Aucune heure de retour n'est demandée. L'autorisation reste valable jusqu'à la fin de son poste. Le gardien enregistre une « Sortie sans retour », sans retour à confirmer ni alerte de retard.

Le **scan du QR code** est facultatif et désactivé par défaut. L'administrateur peut l'activer dans *Paramètres* si la société équipe le poste de garde d'une tablette avec caméra.

Statuts : `BROUILLON`, `EN ATTENTE` 🟡, `VALIDÉE` 🟢, `REFUSÉE` 🔴, `ANNULÉE`, `SORTIE EFFECTUÉE` 🔵, `RETOUR EFFECTUÉ`, `EXPIRÉE` ⚫. Un opérateur qui dépasse son heure de retour prévue apparaît en 🔴 **RETOUR EN RETARD**.

## Fonctionnalités

- **Rôles** : administrateur, chef d'équipe, RH / responsable et gardien. Les opérateurs n'ont pas de compte.
- **Règles métier vérifiées par le serveur** :
  - un chef d'équipe ne crée des autorisations que pour son équipe, sauf s'il a le « droit spécial » ;
  - deux demandes ne peuvent pas se chevaucher ;
  - une demande expire automatiquement à la fin de sa période ;
  - le gardien ne peut sortir qu'une autorisation validée et en cours de validité. La tolérance avant l'heure prévue se règle dans les paramètres (30 min par défaut) ;
  - une autorisation déjà utilisée ne peut plus être annulée.
- **Notifications** :
  - dans l'application, en temps réel (SSE), avec un signal sonore et une bannière sur la tablette du gardien ;
  - **Web Push** sur l'appareil (bouton « Activer » dans *Notifications*, HTTPS requis) ;
  - **email** facultatif (SMTP).
- **Poste de garde** : grands boutons, vérification instantanée, scan du **QR code** par la caméra. Le gardien voit les sorties du jour, les opérateurs à l'extérieur, les retours et l'historique des contrôles. Il n'a **pas accès** au motif, aux commentaires ni aux pièces jointes.
- **QR codes** : un badge par opérateur, imprimable depuis *Matricules*. Le QR sert **uniquement** à identifier l'opérateur. Si un badge est perdu, on le régénère.
- **Tableau de bord** : chiffres du jour, demandes en attente, opérateurs à l'extérieur et retards, tendance sur 7 jours, répartition par type et par équipe.
- **Historique et recherche** sur toute la durée conservée :
  - critères : matricule, nom, prénom, période (aujourd'hui, hier, cette semaine, ce mois ou dates au choix), service, équipe, chef d'équipe, gardien, statut et type ;
  - **export CSV** qui s'ouvre directement dans Excel.
- **Journal d'audit** : il enregistre chaque action avec l'utilisateur, la date, l'heure, l'IP et les valeurs avant et après. Il est **impossible de le modifier ou de le supprimer**, car des triggers SQLite le bloquent. Les entrées sont **chaînées par empreinte SHA-256**, et un bouton « Vérifier l'intégrité » contrôle cette chaîne.
- **Administration** : utilisateurs, opérateurs (avec photo et import CSV), équipes, services, postes et horaires, paramètres, sauvegardes.

## Sécurité

- Mots de passe hachés avec **scrypt**. Politique imposée : 10 caractères minimum, avec majuscule, minuscule, chiffre et caractère spécial.
- Compte **verrouillé 15 min** après 5 échecs de connexion. Les tentatives sont aussi limitées par adresse IP.
- Sessions côté serveur avec cookie `HttpOnly` et `SameSite=Strict`. **Déconnexion automatique après inactivité** : 20 min par défaut, 8 h pour la tablette du gardien. Les deux durées se règlent.
- Protection CSRF : en-tête applicatif obligatoire et vérification de l'origine.
- En-têtes de sécurité : CSP stricte, X-Frame-Options, nosniff, HSTS en HTTPS.
- Les droits sont contrôlés **par le serveur** pour chaque route. Une validation enregistre qui a validé, la date, l'heure et l'action.
- Un élément lié à un historique (opérateur, utilisateur, équipe…) est **désactivé au lieu d'être supprimé**. Aucune trace ne se perd.
- **Sauvegardes** : une automatique par jour (heure et nombre de copies conservées réglables), plus une manuelle depuis *Paramètres* ou avec `npm run backup`. Elles utilisent `VACUUM INTO` et restent cohérentes même pendant l'utilisation. Copiez régulièrement le dossier `data/backups` sur un autre support.

## Dates, heures et fuseau horaire

- Les instants techniques sont stockés en **UTC** (création, validation, sortie réelle, retour réel…).
- La saisie du chef d'équipe (date, heure de sortie, heure de retour) est conservée en heure locale.
- Les heures s'affichent dans le **fuseau de l'entreprise** (`Africa/Tunis` par défaut, modifiable dans *Paramètres*). L'heure d'été est gérée.
- Si l'heure de retour est inférieure à l'heure de sortie, le retour a lieu le lendemain. Le formulaire affiche les deux dates complètes avant l'envoi.

## Déploiement en production

```bash
# Variables utiles
PORT=443 HTTPS_KEY=/chemin/cle.pem HTTPS_CERT=/chemin/cert.pem npm start
# ou derrière un reverse proxy (nginx, IIS…) qui gère le HTTPS :
PORT=3000 TRUST_PROXY=1 SECURE_COOKIES=1 npm start
```

| Variable | Rôle |
|---|---|
| `PORT`, `HOST` | Écoute (défaut `0.0.0.0:3000`) |
| `DATA_DIR` | Dossier de la base, des photos, des pièces jointes et des sauvegardes (défaut `./data`) |
| `ADMIN_PASSWORD` | Mot de passe du compte `admin` initial |
| `TZ_ENTREPRISE` | Fuseau initial (défaut `Africa/Tunis`) |
| `HTTPS_KEY`, `HTTPS_CERT` | HTTPS direct |
| `TRUST_PROXY=1`, `SECURE_COOKIES=1` | Derrière un reverse proxy HTTPS |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | Notifications par email |
| `VAPID_SUBJECT` | Contact pour Web Push (les clés sont générées automatiquement) |

**HTTPS est fortement recommandé**, car il est indispensable pour la **caméra (QR)** et les **notifications push** sur la tablette. Pour faire tourner le service en continu, utilisez un service système (systemd ou NSSM sous Windows) ou `pm2`.

## Tests

```bash
npm test
```

17 tests automatisés reproduisent les scénarios demandés avec une horloge simulée :

- autorisation pendant les heures RH, après 17:00, pendant la pause, à 23:30 et à 02:00 ;
- poste 23:00–07:00 et passage d'une date à l'autre ;
- validation RH, notification temps réel au gardien, sortie réelle à 23:35 et retour réel à 00:48 (durée 1 h 13 min) ;
- autorisation expirée, autorisation refusée, recherche dans l'historique six mois après ;
- règles de rôles, CSRF, verrouillage de compte, inactivité, intégrité de l'audit, QR code et heure d'été.

## Architecture

```
autorisations-sortie/
├── src/
│   ├── server.js              # démarrage HTTP/HTTPS
│   ├── app.js                 # Express, sécurité, tâches planifiées (expiration, retards, sauvegardes)
│   ├── db/schema.sql          # tables : users, employees, teams, shifts, services, exit_authorizations,
│   │                          #          gate_movements, gate_checks, audit_logs, notifications, sessions…
│   ├── services/authorizations.js  # workflow complet et règles métier
│   ├── routes/                # API REST (auth, admin, autorisations, poste de garde, notifications, SSE)
│   └── lib/                   # temps/fuseau, audit chaîné, notifications, sécurité, sauvegardes
├── public/                    # interface (HTML/CSS/JS sans framework, sans étape de build)
│   └── js/views/              # tableau de bord, autorisations, historique, poste de garde, administration
└── test/                      # tests des scénarios
```
