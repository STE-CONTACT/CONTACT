# Mettre l'application en ligne seul, sans être informaticien (Render)

Résultat : une adresse du type **`https://autorisations-sortie-xxxx.onrender.com`**. Les responsables et le gardien l'ouvrent sur leur téléphone, **en 4G ou en Wi-Fi**, 24 h/24.

- **Aucune commande à taper** : tout se fait avec la souris, dans le navigateur.
- **Durée** : environ 30 minutes.
- **Coût** : environ **7,25 $ par mois (≈ 23 DT)**, payé par carte bancaire internationale (Visa / Mastercard).
- Il faut l'offre payante « Starter » : l'offre gratuite **se met en veille** et le gardien attendrait 1 minute à chaque ouverture, donc elle ne convient pas.

---

## Avant de commencer

Vous avez besoin de :
- votre compte **GitHub**, celui qui contient le dépôt `ste-contact/contact` ;
- une **carte bancaire** utilisable sur internet ;
- un **mot de passe administrateur** que vous inventez maintenant : au moins 10 caractères, avec une majuscule, une minuscule, un chiffre et un symbole. Par exemple `Contact#Sorties2026`. **Notez-le.**

---

## Étape 1 — Créer le compte Render

1. Ouvrez **https://render.com**.
2. Cliquez sur **Get Started**, puis sur **GitHub**.
3. Acceptez (**Authorize Render**).

## Étape 2 — Donner accès au dépôt

1. Render demande l'accès à vos dépôts GitHub. Choisissez **Only select repositories**, puis le dépôt **`contact`**.
2. Cliquez sur **Install** (ou **Save**).

## Étape 3 — Créer l'application en un clic

1. Dans Render, cliquez en haut sur **New +**, puis sur **Blueprint**.
2. Choisissez le dépôt **`ste-contact/contact`**.
3. **Branche** : choisissez `main` si les modifications ont été fusionnées. Sinon, choisissez `claude/besoin-app-rfrau0`.
4. Render lit le fichier de configuration et affiche :
   - un service **`autorisations-sortie`** (Starter, Frankfurt) ;
   - un disque **`donnees`** (1 Go), où sont gardées vos données.
5. Render demande la valeur de **`ADMIN_PASSWORD`** : tapez le mot de passe administrateur que vous avez noté.
6. Cliquez sur **Apply** (ou **Create**). Si Render le demande, ajoutez la carte bancaire.

## Étape 4 — Attendre la mise en ligne (3 à 5 minutes)

1. Cliquez sur le service **`autorisations-sortie`**.
2. Attendez que l'état passe à **« Live »** (vert).
3. En haut de la page, Render affiche l'adresse : **`https://autorisations-sortie-xxxx.onrender.com`**. **Notez-la** : c'est l'adresse de votre application.

## Étape 5 — Première connexion (sur un PC)

1. Ouvrez l'adresse.
2. Connectez-vous avec l'identifiant **`admin`** et le mot de passe de l'étape 3.
3. L'application vous demande d'en choisir un nouveau : faites-le et notez-le.

## Étape 6 — Préparer l'application

Dans l'ordre :
1. **Paramètres** : vérifiez le nom de l'entreprise, puis **Enregistrer**.
2. **Utilisateurs** → **Nouvel utilisateur** pour chaque **responsable / chef**, le **RH** et chaque **gardien**. Pour chacun :
   - laissez le mot de passe vide : l'application génère un mot de passe temporaire et l'affiche ;
   - donnez ce mot de passe à la personne : elle le changera à sa première connexion.
3. **Affectations** → **Nouvelle affectation** : Injection, Assemblage, Production…, et choisissez le **responsable** de chacune.
4. **Opérateurs** : ajoutez le personnel un par un, ou en une fois :
   - dans Excel, préparez les colonnes `matricule | nom | prenom | service | affectation | poste` ;
   - **Fichier → Enregistrer sous → CSV (séparateur : point-virgule)** ;
   - dans l'application, **Matricules → Importer (CSV)**, puis choisissez le fichier.
5. Si vous voulez des badges QR : **Matricules → Imprimer les badges**.

## Étape 7 — Installer sur les téléphones

Sur **chaque téléphone** (responsables, RH, gardien) :
1. Ouvrez **Chrome** (Android) ou **Safari** (iPhone) à l'adresse de l'étape 4.
2. Connectez-vous **une seule fois** avec le compte de la personne.
3. Installez l'application :
   - **Android** : menu **⋮** → **Installer l'application** ;
   - **iPhone** : **Partager** → **Sur l'écran d'accueil**.
4. Ouvrez l'icône « Sorties », puis **Notifications** → **Activer**.

Pour le **téléphone du gardien** :
- **Paramètres de l'application** (compte admin) : cochez « Afficher le bouton Scanner QR » si vous utilisez les badges.
- **Paramètres du téléphone** → Applications → Chrome → **Batterie : Non restreinte**.
- Le laisser sur son chargeur au poste de garde.

---

## Ensuite, au quotidien

- **Rien à faire** : Render garde l'application allumée et la redémarre seule si besoin.
- **Mises à jour** : quand une nouvelle version est publiée sur la branche choisie, Render l'installe **automatiquement**. Les données sont conservées.
- **Sauvegarde** : une fois par semaine, **Paramètres → Sauvegardes** → **Télécharger** la dernière, et rangez-la sur un PC ou une clé USB.
- **Adresse personnalisée** (facultatif, plus tard) : dans Render → **Settings → Custom Domains**, vous pouvez utiliser `sorties.votre-societe.tn`.

## En cas de problème

| Problème | Que faire |
|---|---|
| L'état reste « Build failed » ou « Deploy failed » | Dans Render, cliquez sur **Logs**, faites une capture d'écran et envoyez-la. |
| Mot de passe admin refusé | Il doit respecter la règle (10 caractères, majuscule, minuscule, chiffre, symbole). Dans Render → **Environment**, corrigez `ADMIN_PASSWORD`. Ce mot de passe n'est utilisé qu'à la toute première installation. |
| Le gardien voit « Pas de connexion » | Le téléphone n'a plus de 4G ni de Wi-Fi : appliquez la consigne de secours (appeler le responsable). |
| Un téléphone est perdu | **Utilisateurs** → modifier la personne → décocher **Compte actif**. |
