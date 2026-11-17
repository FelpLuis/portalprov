# Portal no servidor .13 (190.111.110.13)

O .13 já tem nginx + certbot (Documentação em 443) e o Zabbix em 127.0.0.1:19090.
O portal entra nesse nginx — **não instale o Caddy aqui** (ele brigaria pelas portas 80/443).

```bash
# 1. DNS (HostGator → Zone Editor → updown.com.br):  portal  A  190.111.110.13
dig +short portal.updown.com.br @8.8.8.8          # tem de responder 190.111.110.13

# 2. Portal
sudo bash deploy/instalar.sh                      # /opt/portal-noc, serviço portal-noc em 127.0.0.1:8790
sudo nano /etc/portal-noc.env                     # PORTAL_URL=https://portal.updown.com.br  COOKIE_DOMAIN=.updown.com.br

# 3. nginx + certificado
sudo cp deploy/nginx-portal.conf.example /etc/nginx/sites-available/portal-noc
sudo ln -sf /etc/nginx/sites-available/portal-noc /etc/nginx/sites-enabled/
sudo certbot certonly --webroot -w /var/www/letsencrypt -d portal.updown.com.br   # ou: certbot --nginx -d portal.updown.com.br
sudo nginx -t && sudo systemctl reload nginx

# 4. Conferir
curl -s http://127.0.0.1:8790/healthz             # ok
curl -sI https://portal.updown.com.br/login | head -1
curl -s -o /dev/null -w '%{http_code}\n' https://portal.updown.com.br/sso/verificar?sistema=documentacao   # 401 (sem sessão) = certo
```

Documentação neste mesmo servidor: use `integracoes/nginx/portal-sso-local.conf` e
`integracoes/nginx/exemplo-documentacao.conf` (consulta o portal em 127.0.0.1:8790).
Os painéis do monitoramento (UPT-UBUNTU02) usam `integracoes/nginx/portal-sso.conf`, que vai por HTTPS.
