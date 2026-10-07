#!/usr/bin/env bash
# =====================================================================
#  Installation de l'application « Autorisations de sortie » sur un
#  serveur en ligne (Ubuntu 22.04 / 24.04 ou Debian 12).
#
#  Usage (dans le dossier de l'application copié sur le serveur) :
#     sudo bash deploiement/installer-serveur.sh sorties.ma-societe.tn moi@ma-societe.tn
#
#  - Installe Node.js 22 et Caddy (HTTPS automatique avec Let's Encrypt)
#  - Installe l'application dans /opt/autorisations-sortie
#  - Données dans /var/lib/autorisations-sortie (conservées lors des mises à jour)
#  - Démarrage automatique et redémarrage en cas de problème (systemd)
#  - Pare-feu : seuls SSH, HTTP et HTTPS sont ouverts
#  Relancer le même script pour installer une nouvelle version.
# =====================================================================
set -euo pipefail

DOMAINE="${1:-}"
EMAIL="${2:-}"
if [ -z "$DOMAINE" ] || [ -z "$EMAIL" ]; then
  echo "Usage : sudo bash deploiement/installer-serveur.sh <domaine> <email>"
  echo "Exemple : sudo bash deploiement/installer-serveur.sh sorties.ma-societe.tn admin@ma-societe.tn"
  exit 1
fi
[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR=/opt/autorisations-sortie
DATA_DIR=/var/lib/autorisations-sortie
SERVICE=autorisations-sortie

echo "==> Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw openssl

echo "==> Node.js 22"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Caddy (serveur web + certificat HTTPS automatique)"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Application"
id sorties >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin sorties
mkdir -p "$APP_DIR" "$DATA_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  (cd "$SRC_DIR" && tar --exclude=./node_modules --exclude=./data --exclude=./.env -cf - .) | (cd "$APP_DIR" && tar -xf -)
fi
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund

PREMIERE_INSTALLATION=0
if [ ! -f "$APP_DIR/.env" ]; then
  PREMIERE_INSTALLATION=1
  ADMIN_PASS="$(openssl rand -base64 12 | tr -d '/+=')Aa7!"
  cat > "$APP_DIR/.env" <<EOF
HOST=127.0.0.1
PORT=3000
DATA_DIR=$DATA_DIR
TRUST_PROXY=1
SECURE_COOKIES=1
TZ_ENTREPRISE=Africa/Tunis
ADMIN_PASSWORD=$ADMIN_PASS
VAPID_SUBJECT=mailto:$EMAIL
EOF
fi
chmod 600 "$APP_DIR/.env"
chown -R sorties:sorties "$APP_DIR" "$DATA_DIR"

echo "==> Service (démarrage automatique)"
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=Autorisations de sortie
After=network-online.target
Wants=network-online.target

[Service]
User=sorties
Group=sorties
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning --env-file=$APP_DIR/.env src/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable $SERVICE >/dev/null
systemctl restart $SERVICE

echo "==> HTTPS pour $DOMAINE"
cat > /etc/caddy/Caddyfile <<EOF
{
	email $EMAIL
}

$DOMAINE {
	encode gzip
	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
	}
}
EOF
systemctl enable caddy >/dev/null
systemctl restart caddy

echo "==> Pare-feu"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

sleep 3
if curl -fsS http://127.0.0.1:3000/api/auth/public >/dev/null; then
  echo ""
  echo "======================================================================"
  echo "  Application installée et en marche."
  echo "  Adresse : https://$DOMAINE"
  if [ "$PREMIERE_INSTALLATION" = "1" ]; then
    echo ""
    echo "  Compte administrateur initial :"
    echo "     Identifiant  : admin"
    echo "     Mot de passe : $ADMIN_PASS"
    echo "  (le changement du mot de passe sera demandé à la première connexion)"
  fi
  echo ""
  echo "  Si la page ne s'ouvre pas encore : vérifiez que le domaine $DOMAINE"
  echo "  pointe bien vers l'adresse IP de ce serveur (enregistrement DNS « A »)."
  echo "======================================================================"
else
  echo "[!] L'application ne répond pas. Voir : journalctl -u $SERVICE -n 50"
  exit 1
fi
