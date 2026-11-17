# UPDOWN NOC — Portal de acesso

Login único do NOC: o usuário e a senha criados aqui são os mesmos em **todas as plataformas**.
O portal também concentra os links (redirecionamentos) e registra quem acessou o quê.

> O sistema Topologia NOC que estava neste repositório foi preservado na branch
> `backup/topologia-noc-2026-11-17` e na tag `backup-topologia-2026-11-17`.

## O que tem

| Tela | Quem vê | O que faz |
| --- | --- | --- |
| Login | todos | Entrada única; "manter conectado" para o telão (30 dias); modo claro e escuro |
| Painel | todos | Cartões das plataformas liberadas para o usuário, com status online |
| Redirecionamentos | administrador | Cadastrar/editar/desativar destinos, acessos por sistema, gráfico de 7/30/90 dias |
| Usuários | administrador | Criar, editar perfil, liberar sistemas, trocar senha, desativar, derrubar sessões |
| Logs de acesso | administrador | Logins, senhas erradas, acessos por sistema, com filtros |
| Integrações | administrador | Como cada plataforma usa o login do portal (blocos prontos para copiar) |

Administrador inicial: **luis.felipe** (a senha é a combinada; no código só existe o hash scrypt).
Ele é criado no primeiro start, em `data/users.json`.

## Plataformas

| Sistema | Destino | Login |
| --- | --- | --- |
| Painel das OLTs | `https://monitoramento.updown.com.br:8443/` | login único (nginx) |
| Painel de Links | `https://monitoramento.updown.com.br:9443/` | login único (nginx) |
| TV · Links / TV · ISP | `:9443/tv`, `:9443/tv-isp` | login único (nginx) |
| Alertas PON / CTO | `https://monitoramento.updown.com.br:8446/` | login único (nginx) |
| Documentação | `https://documentacao.noc.updown.com.br/` | login único (nginx) |
| IA NOC | `https://nia.updown.com.br/` | mesmo login via API |

Os destinos ficam editáveis na tela **Redirecionamentos** (a semente está em `config/sistemas.json`).

## Como o login único funciona

1. O portal grava um cookie de sessão assinado (`updown_sso`) no domínio `.updown.com.br`
   — vale em todos os subdomínios **e portas**.
2. **Painéis atrás de nginx** (nocup e documentação): o nginx pergunta ao portal
   `GET /sso/verificar?sistema=<id>` antes de servir cada página.
   `204` libera, `401` manda para o login do portal (e volta para o painel depois), `403` = usuário sem acesso àquele sistema.
   Arquivos: `integracoes/nginx/`.
   **Para ligar tudo de uma vez**: no servidor dos painéis, `cd nocup && git pull && sudo bash vincular-portal.sh`
   (reescreve os sites do nginx, liga `PORTAL=1` no PON e na documentação e importa os usuários antigos; `--desfazer` volta).
   `sistema` aceita lista (`links,tv-links,tv-isp`): libera quem tiver qualquer um deles.
3. **IA NOC**: os usuários entram com o mesmo login pela API compatível `/sso/ianoc/api/auth/{login,me,logout}`.
   Os dados do IA NOC continuam vindo do `sistema.updown.com.br`. Aplique `integracoes/ianoc/ianoc-login-portal.patch`
   no repositório IANOC e configure `NOC_AUTH_URL=https://portal.updown.com.br/sso/ianoc` (mantenha `NOC_API_URL=https://sistema.updown.com.br`).

Desativar um usuário, trocar a senha ou "derrubar sessões" corta o acesso em todas as plataformas
(nos painéis via nginx, em até 30 s por causa do cache do `auth_request`).

### Migrar os usuários atuais do painel-auth (Painel das OLTs)

```bash
sudo -u portal-noc DATA_DIR=/var/lib/portal-noc node /opt/portal-noc/server.mjs importar-painel-auth /etc/painel-olt/users.json
```

Os usuários entram com a senha que já usam (o hash PBKDF2 é aceito e regravado em scrypt no primeiro login).
Depois disso, desligue o login próprio do PON (`LOGIN=0`) e da documentação (`LOGIN=0`) — quem protege passa a ser o nginx com o portal.

## Instalar

Requisitos: Node.js 18+ (sem dependências npm).

```bash
git clone https://github.com/FelpLuis/Topologia-NOC.github.io portal-noc && cd portal-noc
sudo bash deploy/instalar.sh          # /opt/portal-noc, serviço systemd portal-noc, dados em /var/lib/portal-noc
sudo nano /etc/portal-noc.env         # PORTAL_URL, COOKIE_DOMAIN=.updown.com.br
```

TLS: `deploy/Caddyfile.example` ou `deploy/nginx-portal.conf.example`.

> Endereço do portal: **https://portal.updown.com.br**, hospedado no servidor .13 — passo a passo em `deploy/servidor-13.md`. O `sistema.updown.com.br` continua no ar — o IA NOC usa os dados dele.

## Desenvolvimento

```bash
npm run dev     # http://127.0.0.1:8790 (cookie sem Secure)
npm test        # testes de login, SSO, permissões e redirecionamento
```

Variáveis em `.env.example`. Dados em `data/` (fora do git): `users.json`, `sistemas.json`, `secret.key`, `audit.log`.

## Segurança

- Senhas com scrypt; comparação em tempo constante; bloqueio de 15 min após 5 erros (por IP e por usuário).
- Sessão em cookie `HttpOnly`, `Secure` (atrás de HTTPS) e `SameSite=Lax`, assinado com HMAC; revogável por usuário.
- Escritas exigem o cabeçalho `X-Portal` e mesma origem (CSRF); CSP restritiva, sem script inline.
- Retorno após login só para caminhos internos ou para a origem de um sistema cadastrado (sem redirecionamento aberto).
- Sempre sobra pelo menos um administrador ativo.
