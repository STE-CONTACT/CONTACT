# Mettre l'application en ligne (accessible en Wi-Fi et en 4G)

Objectif : le **responsable** donne une autorisation depuis son téléphone, où qu'il soit, et le **gardien** la voit immédiatement sur son téléphone, **en 4G**, sans dépendre du Wi-Fi ni d'un PC allumé dans la société.

```
Téléphone responsable (4G / Wi-Fi) ─┐
Téléphone gardien     (4G / Wi-Fi) ─┼── Internet ──►  https://sorties.ma-societe.tn
PC du RH                            ─┘                 (serveur en ligne, 24 h/24)
```

Ce qu'il faut :

| Élément | Exemple | Coût indicatif |
|---|---|---|
| Un petit **serveur en ligne** (VPS Linux) | OVHcloud VPS, Hetzner Cloud, Contabo, ou un hébergeur tunisien | 15 à 40 DT / mois |
| Un **nom de domaine** ou un sous-domaine | `sorties.ma-societe.tn` (sous-domaine du site de la société) | 0 si la société a déjà un domaine |
| Une personne à l'aise avec un ordinateur | 1 heure, une seule fois | — |

---

## Étape 1 — Louer le serveur

Chez l'hébergeur de votre choix, commandez un **VPS** avec :
- système **Ubuntu 24.04** (ou 22.04) ;
- 1 processeur, **1 à 2 Go de mémoire**, 20 Go de disque : largement suffisant pour plusieurs centaines d'employés.

L'hébergeur vous envoie :
- l'**adresse IP** du serveur, par exemple `51.75.12.34` ;
- un identifiant (souvent `root` ou `ubuntu`) et un mot de passe.

## Étape 2 — Créer l'adresse internet (domaine)

Dans l'espace de gestion du domaine de la société (chez le registrar : Tunisie Telecom, OVH, GoDaddy…), ajoutez un enregistrement **DNS** :

| Type | Nom | Valeur |
|---|---|---|
| `A` | `sorties` | l'adresse IP du serveur (ex. `51.75.12.34`) |

L'adresse de l'application sera alors `https://sorties.ma-societe.tn`. La prise en compte prend de quelques minutes à quelques heures.

> Pas de domaine ? La personne qui gère le site web de la société peut créer ce sous-domaine en 5 minutes.

## Étape 3 — Copier l'application sur le serveur

Depuis un PC Windows :
1. Installez **WinSCP** (gratuit) : https://winscp.net
2. Connectez-vous au serveur avec l'adresse IP, l'identifiant et le mot de passe de l'étape 1.
3. Copiez le dossier `autorisations-sortie` (le contenu du ZIP) dans le dossier personnel, par exemple `/root/autorisations-sortie`. Ne copiez **pas** le dossier `data` de vos tests.

## Étape 4 — Lancer l'installation automatique

1. Installez **PuTTY** (gratuit) : https://putty.org, puis connectez-vous au serveur avec la même adresse IP. Sur Windows 10/11, vous pouvez aussi taper `ssh root@51.75.12.34` dans un terminal.
2. Tapez (en remplaçant le domaine et l'email) :
   ```
   cd autorisations-sortie
   sudo bash deploiement/installer-serveur.sh sorties.ma-societe.tn admin@ma-societe.tn
   ```
3. Après quelques minutes, le script affiche :
   ```
   Application installée et en marche.
   Adresse : https://sorties.ma-societe.tn
   Identifiant  : admin
   Mot de passe : xxxxxxxx
   ```
   **Notez ce mot de passe.**

Le script installe tout automatiquement :
- l'application ;
- le **HTTPS (cadenas)** avec un certificat gratuit renouvelé tout seul ;
- le **démarrage automatique** (l'application redémarre seule après une coupure ou un redémarrage du serveur) ;
- le pare-feu.

## Étape 5 — Préparer l'application (administrateur)

Sur un PC, ouvrez `https://sorties.ma-societe.tn` et connectez-vous en `admin`. Un nouveau mot de passe est demandé, choisissez-le. Ensuite :
1. **Paramètres** : nom de l'entreprise et fuseau horaire.
2. **Affectations** : Injection, Assemblage, Production…, avec leur responsable (à faire après l'étape suivante).
3. **Utilisateurs** : créez les comptes des **chefs / responsables**, du **RH** et des **gardiens**. Chaque personne reçoit un mot de passe temporaire, qu'elle change à sa première connexion.
4. **Opérateurs** : saisissez le personnel, ou importez-le d'un coup dans **Matricules → Importer (CSV)** depuis un fichier Excel enregistré en CSV, avec les colonnes `matricule;nom;prenom;service;affectation;poste`.
5. Pour les badges QR : **Matricules → Imprimer les badges**.

> Partez d'une base **vide** : n'utilisez pas `npm run seed:demo` sur le serveur. Les comptes de démonstration ne doivent pas exister en production.

## Étape 6 — Installer sur les téléphones (responsables et gardien)

Sur chaque téléphone, en 4G ou en Wi-Fi :
1. Ouvrez **Chrome** (Android) ou **Safari** (iPhone) à l'adresse `https://sorties.ma-societe.tn`.
2. Connectez-vous **une seule fois** avec le compte de la personne.
3. Installez l'application :
   - **Android** : menu **⋮** → **« Installer l'application »** (ou « Ajouter à l'écran d'accueil ») ;
   - **iPhone** : bouton **Partager** → **« Sur l'écran d'accueil »**.

   L'icône « Sorties » s'ouvre en **plein écran**, comme une vraie application.
4. Dans l'application : **Notifications** → **Activer**, puis acceptez. Le gardien reçoit alors les alertes même quand l'application est fermée.
5. Pour le **gardien** :
   - **Paramètres** → cochez « Afficher le bouton Scanner QR », si vous utilisez les badges ;
   - téléphone sur son chargeur au poste ;
   - batterie de Chrome réglée sur **« Non restreinte »**.

L'application **reste connectée en permanence**, et se reconnecte seule après une coupure 4G.

## Étape 7 — Sauvegardes

- Une sauvegarde automatique est faite **chaque nuit** sur le serveur.
- **Une fois par semaine** : **Paramètres → Sauvegardes → Télécharger** la dernière, et gardez-la sur un autre support (PC du RH, clé USB, Drive de la société).
- Activez aussi la sauvegarde proposée par l'hébergeur (« snapshots »), souvent pour quelques dinars par mois.

## Installer une nouvelle version plus tard

1. Copiez le nouveau dossier sur le serveur avec WinSCP, en remplaçant l'ancien.
2. Relancez la même commande que l'étape 4.

Les **données et les comptes sont conservés**.

## En cas de problème

| Problème | Vérification |
|---|---|
| La page ne s'ouvre pas | Le domaine pointe-t-il vers la bonne IP (étape 2) ? Attendez quelques heures après la création du DNS. |
| « Votre connexion n'est pas privée » juste après l'installation | Le certificat se crée dès que le domaine pointe vers le serveur : attendez quelques minutes. |
| Voir l'état de l'application | Sur le serveur : `systemctl status autorisations-sortie` |
| Voir les erreurs | `journalctl -u autorisations-sortie -n 50` |
| Redémarrer l'application | `sudo systemctl restart autorisations-sortie` |

## Procédure de secours (recommandée)

Si un jour le gardien voit le bandeau orange **« Pas de connexion »** (pas de 4G, serveur en maintenance), il **appelle le responsable** pour confirmer l'autorisation de vive voix, et note l'heure. Prévoyez cette consigne par écrit au poste de garde.
