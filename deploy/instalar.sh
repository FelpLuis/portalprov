#!/usr/bin/env bash
# Instala/atualiza o Portal NOC neste servidor (Ubuntu/Debian, Node >= 18).
#   sudo bash deploy/instalar.sh
set -euo pipefail
DEST=/opt/portal-noc
DATA=/var/lib/portal-noc
command -v node >/dev/null || { echo "Instale o Node.js 18+ antes."; exit 1; }
id portal-noc >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin portal-noc
mkdir -p "$DEST" "$DATA"
rsync -a --delete --exclude .git --exclude data ./ "$DEST/"
chown -R portal-noc:portal-noc "$DATA"; chmod 700 "$DATA"
[ -f /etc/portal-noc.env ] || { cp .env.example /etc/portal-noc.env; chmod 640 /etc/portal-noc.env; echo "Revise /etc/portal-noc.env"; }
cp deploy/portal-noc.service /etc/systemd/system/portal-noc.service
systemctl daemon-reload
systemctl enable --now portal-noc
systemctl restart portal-noc
sleep 1
curl -fsS http://127.0.0.1:8790/healthz && echo " — portal rodando em 127.0.0.1:8790"
