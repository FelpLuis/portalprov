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
# Permissões explícitas: servidores com umask 077 deixariam tudo só para o root
# e o serviço (usuário portal-noc) não conseguiria entrar na pasta (status=200/CHDIR).
chown -R root:portal-noc "$DEST"
find "$DEST" -type d -exec chmod 750 {} +
find "$DEST" -type f -exec chmod 640 {} +
chmod 750 "$DEST/deploy/instalar.sh"
chown -R portal-noc:portal-noc "$DATA"; chmod 700 "$DATA"
[ -f /etc/portal-noc.env ] || { cp .env.example /etc/portal-noc.env; echo "Revise /etc/portal-noc.env"; }
chown root:portal-noc /etc/portal-noc.env; chmod 640 /etc/portal-noc.env
cp deploy/portal-noc.service /etc/systemd/system/portal-noc.service
systemctl daemon-reload
systemctl enable --now portal-noc
systemctl restart portal-noc
for _ in 1 2 3 4 5; do curl -fsS http://127.0.0.1:8790/healthz >/dev/null 2>&1 && break; sleep 1; done
if curl -fsS http://127.0.0.1:8790/healthz >/dev/null 2>&1; then
  echo "ok — portal rodando em 127.0.0.1:8790"
else
  echo "O portal não subiu. Veja: journalctl -u portal-noc -n 30 --no-pager" >&2
  exit 1
fi
