# Installer l'application sur le réseau de la société (téléphones et tablettes)

Le principe : **un seul ordinateur** de la société héberge l'application. Tous les téléphones et les tablettes connectés **au même réseau (Wi-Fi de la société)** l'ouvrent dans leur navigateur. Rien n'est à installer depuis un store.

```
   Téléphones chefs d'équipe ─┐
   Téléphones RH ─────────────┼── Wi-Fi société ──► PC serveur (application + base de données)
   Tablette poste de garde ───┘                      ex. https://192.168.1.10:3443
```

---

## Étape 1 — Choisir le PC serveur

- Prenez un PC ou un serveur **toujours allumé**, 24 h/24 car les équipes travaillent en 3×8. Désactivez la mise en veille.
- Il doit être relié au réseau de la société, de préférence **en câble**.
- **Donnez-lui une adresse IP fixe**, par exemple `192.168.1.10`. Le plus simple est une « réservation DHCP » dans la box ou le routeur. Sinon, l'adresse peut changer et les téléphones ne trouveront plus l'application.
- Pour connaître l'adresse : sous Windows, ouvrez une invite de commandes et tapez `ipconfig` (ligne « Adresse IPv4 »).

## Étape 2 — Installer l'application sur le PC serveur

1. Installez **Node.js 22** (version « LTS ») depuis https://nodejs.org.
2. Copiez le dossier `autorisations-sortie` sur le PC, par exemple dans `C:\autorisations-sortie`.
3. Ouvrez une invite de commandes dans ce dossier, puis :
   ```
   npm install
   npm start
   ```
4. La console affiche les adresses à utiliser, par exemple :
   ```
   Accès réseau (téléphones, tablettes) : http://192.168.1.10:3000
   Compte administrateur initial créé — Identifiant : admin — Mot de passe : Tmp-xxxx
   ```

## Étape 3 — Ouvrir le pare-feu Windows

**Le plus simple :** double-cliquez sur **`OUVRIR-ACCES-TELEPHONE.bat`** et acceptez la demande d'administrateur. Ce fichier :
- supprime les règles qui bloquent Node.js (créées si on a refusé la fenêtre « Autoriser l'accès » de Windows) ;
- ouvre le port de l'application ;
- vérifie que l'application est lancée ;
- affiche l'adresse à taper sur le téléphone.

Ensuite, sur l'écran de connexion du PC, un **QR code « Ouvrir sur un téléphone »** permet d'ouvrir l'application sur le téléphone sans taper l'adresse.

Méthode manuelle :

Les téléphones doivent pouvoir joindre le PC. Dans une invite de commandes **en tant qu'administrateur** :

```
netsh advfirewall firewall add rule name="Autorisations de sortie" dir=in action=allow protocol=TCP localport=3000,3443
```

**Premier test** : sur un téléphone connecté au **Wi-Fi de la société** (pas en 4G), ouvrez `http://192.168.1.10:3000`. La page de connexion doit s'afficher.

> ✅ Avec `http://`, l'application fonctionne déjà : connexion, demandes, validation, notifications dans l'application, recherche par matricule au poste de garde.
> ⚠️ En revanche, **le scan du QR code (caméra) et les notifications push** sont bloqués par les téléphones sans **HTTPS**. Faites l'étape 4.

## Étape 4 — Activer le HTTPS (caméra QR + notifications push)

Les téléphones exigent une connexion sécurisée pour utiliser la caméra et les notifications. Sur un réseau interne, la méthode la plus simple est **mkcert**. Il crée un petit « certificat d'entreprise » que l'on installe une seule fois sur chaque téléphone.

### 4.1 — Créer le certificat (sur le PC serveur)

1. Téléchargez `mkcert` pour Windows (fichier `mkcert-vX.X.X-windows-amd64.exe`) depuis https://github.com/FiloSottile/mkcert/releases et renommez-le `mkcert.exe`.
2. Dans le dossier `autorisations-sortie` :
   ```
   mkdir certs
   mkcert -install
   mkcert -key-file certs\serveur-key.pem -cert-file certs\serveur.pem 192.168.1.10 localhost
   mkcert -CAROOT
   ```
   Remplacez `192.168.1.10` par l'adresse IP du serveur. La dernière commande indique le dossier qui contient **`rootCA.pem`**, le certificat à installer sur les téléphones.
3. Copiez `.env.example` en `.env`. Les chemins des certificats y sont déjà remplis.
4. Démarrez l'application avec `npm run start:prod`. L'adresse devient **`https://192.168.1.10:3443`**.

### 4.2 — Installer `rootCA.pem` sur chaque téléphone et tablette (une seule fois)

Envoyez le fichier `rootCA.pem` au téléphone (email, WhatsApp, clé USB…). **Ne partagez jamais** le fichier `rootCA-key.pem`.

**Android**
1. Renommez le fichier en `rootCA.crt` si besoin.
2. *Paramètres → Sécurité (ou « Sécurité et confidentialité ») → Plus de paramètres → Chiffrement et identifiants → Installer un certificat → Certificat CA*.
3. Choisissez le fichier et confirmez. Le chemin exact varie selon la marque : cherchez « certificat » dans les paramètres.

**iPhone / iPad**
1. Ouvrez le fichier reçu. Un message « Profil téléchargé » apparaît.
2. *Réglages → Profil téléchargé → Installer*.
3. **Important** : *Réglages → Général → Informations → Réglages des certificats* → activez la **confiance totale** pour le certificat mkcert.

Ouvrez ensuite `https://192.168.1.10:3443` : il ne doit plus y avoir d'avertissement de sécurité.

> **Alternative** pour un service informatique : un nom de domaine de la société, par exemple `sorties.entreprise.tn`, avec un certificat Let's Encrypt (validation DNS) et un DNS interne qui pointe vers le serveur. Dans ce cas, rien n'est à installer sur les téléphones.

## Étape 5 — Installer l'application sur l'écran d'accueil des téléphones

L'application s'installe comme une vraie application, avec une icône et en plein écran, sans passer par un store.

- **Android (Chrome)** : ouvrez l'adresse, puis menu **⋮ → « Installer l'application »** (ou « Ajouter à l'écran d'accueil »).
- **iPhone (Safari)** : ouvrez l'adresse, puis bouton **Partager → « Sur l'écran d'accueil »**.

## Étape 6 — Activer les notifications sur chaque téléphone

1. Ouvrez l'application installée et connectez-vous.
2. Menu **Notifications → bouton « Activer »**, puis acceptez la demande du téléphone.
3. Faites-le en priorité sur la **tablette du poste de garde** et les **téléphones RH**.

- **iPhone** : les notifications push ne fonctionnent que depuis l'application **installée sur l'écran d'accueil** (étape 5), à partir d'iOS 16.4.
- Sans activation, les notifications restent visibles **dans l'application** (cloche, bandeau et son), tant qu'elle est ouverte.

## Étape 7 — Préparer la tablette du poste de garde

- Connectez-vous avec le compte gardien. L'écran **POSTE DE GARDE** s'ouvre directement.
- Choisissez le poste de garde en haut de l'écran, si l'entreprise en a plusieurs.
- Réglez la tablette pour que **l'écran reste allumé** (*Paramètres → Affichage → Mise en veille de l'écran : jamais*, ou mode « rester éveillé » quand elle est en charge). Laissez-la sur son chargeur.
- La session du gardien reste ouverte 8 h sans activité. Cette durée se règle dans *Paramètres*.
- Le bruit d'alerte nécessite que le volume de la tablette soit activé.

## Étape 8 — Démarrage automatique du serveur

Pour que l'application redémarre seule après une coupure de courant ou un redémarrage du PC :

**Windows (avec NSSM, https://nssm.cc)** — invite de commandes administrateur :
```
nssm install AutorisationsSortie "C:\Program Files\nodejs\node.exe" "--disable-warning=ExperimentalWarning --env-file=.env src\server.js"
nssm set AutorisationsSortie AppDirectory C:\autorisations-sortie
nssm start AutorisationsSortie
```

**Linux (systemd)** — fichier `/etc/systemd/system/autorisations-sortie.service` :
```
[Unit]
Description=Autorisations de sortie
After=network.target
[Service]
WorkingDirectory=/opt/autorisations-sortie
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning --env-file=.env src/server.js
Restart=always
User=sorties
[Install]
WantedBy=multi-user.target
```
puis `sudo systemctl enable --now autorisations-sortie`.

## Étape 9 — Sauvegardes

Une sauvegarde automatique de la base est faite chaque nuit dans `data\backups` (réglage dans *Paramètres*). **Copiez ce dossier régulièrement sur un autre support** : disque externe, NAS ou serveur de fichiers. Si le PC tombe en panne, tout l'historique est dans ces fichiers.

---

## Dépannage

| Problème | Solution |
|---|---|
| Le téléphone n'ouvre pas la page | Vérifiez qu'il est sur le **Wi-Fi de la société** (pas en 4G), que l'adresse IP du serveur est la bonne et que le pare-feu est ouvert (étape 3). Certains Wi-Fi « invités » isolent les appareils : utilisez le Wi-Fi interne. |
| « Votre connexion n'est pas privée » | Le certificat `rootCA.pem` n'est pas installé sur ce téléphone, ou n'est pas en confiance totale sur iPhone (étape 4.2). |
| Le bouton SCANNER indique « Caméra non disponible » | L'application est ouverte en `http://` : utilisez l'adresse `https://` (étape 4). Autorisez aussi l'accès à la caméra quand le navigateur le demande. |
| Pas de notification quand l'application est fermée | Activez-les dans *Notifications* (étape 6). Sur iPhone, utilisez l'application installée sur l'écran d'accueil. |
| L'adresse a changé | Le serveur n'a pas d'IP fixe : faites une réservation DHCP (étape 1) et refaites le certificat (étape 4.1). |
| Mot de passe admin perdu | Un autre administrateur peut le réinitialiser dans *Utilisateurs*. |
