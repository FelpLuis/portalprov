// UPDOWN NOC — Portal de acesso (login único / SSO)
//
// - Login e gestão de usuários do NOC.
// - Concentrador de links (/ir/<id>) para os sistemas, com registro de acesso.
// - Provedor de login único para as plataformas:
//     * nginx (auth_request) → GET /sso/verificar?sistema=<id>   (painéis do nocup, documentação)
//     * API compatível com o login do sistema NOC → /sso/<id>/api/auth/{login,me,logout}  (IA NOC)
//
// Sem dependências: só Node.js (>= 18).
import http from "node:http";
import { promises as fs, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SISTEMAS_FILE = path.join(DATA_DIR, "sistemas.json");
const SECRET_FILE = path.join(DATA_DIR, "secret.key");
const AUDIT_FILE = path.join(DATA_DIR, "audit.log");
const SISTEMAS_SEED = path.join(ROOT, "config", "sistemas.json");

const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || "127.0.0.1";
const SESSION_HORAS = Number(process.env.SESSION_HORAS || 12);
const LEMBRAR_DIAS = Number(process.env.LEMBRAR_DIAS || 30);
const COOKIE = process.env.COOKIE_NAME || "updown_sso";
// Domínio do cookie. Com ".updown.com.br" a mesma sessão vale em todos os
// subdomínios e portas (monitoramento.updown.com.br:8443, :9443, :8446...).
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || "";
const COOKIE_SECURE = process.env.COOKIE_SECURE || "auto"; // auto | 1 | 0
const PORTAL_URL = (process.env.PORTAL_URL || "https://portal.updown.com.br").replace(/\/+$/, "");

export const PERFIS = ["administrador", "analista", "tecnico", "atendimento", "logistica"];
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,39}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const MIN_PASSWORD = 8;

// Administrador inicial, criado só quando data/users.json ainda não existe.
// No código fica apenas o hash scrypt da senha — nunca a senha.
const SEED_ADMIN = {
  username: "luis.felipe",
  name: "Luis Felipe",
  role: "administrador",
  sistemas: ["*"],
  password_hash:
    "scrypt$16384$8$1$PMyir7Pl3xR2faAi3icy4w==$JygwiX1RCnWY4wxs97OWpGSnZNt/Ktpv+UuJw2u5g89VEnr1/WXnMwlRM2jLg6OBw3VDrsCrgv3Uh2CwlC8LPA==",
};

// ================================================================ senhas
export function hashPassword(password) {
  const N = 16384, r = 8, p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

const b64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split("$");
    if (parts[0] === "scrypt") {
      const [, N, r, p, salt, hash] = parts;
      const expected = Buffer.from(hash, "base64");
      const got = crypto.scryptSync(password, Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
      return crypto.timingSafeEqual(expected, got);
    }
    if (parts[0] === "pbkdf2_sha256") {
      // Hash importado do painel-auth (nocup): o usuário mantém a senha antiga.
      const [, it, salt, dk] = parts;
      const expected = b64url(dk);
      const got = crypto.pbkdf2Sync(password, b64url(salt), +it, expected.length, "sha256");
      return crypto.timingSafeEqual(expected, got);
    }
  } catch {}
  return false;
}
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString("hex"));

// ================================================================ dados
let users = [];
let sistemas = { grupos: [], sistemas: [] };
let SECRET;

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

async function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(tmp, file);
}

let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));
const saveUsers = () => serial(() => writeJsonAtomic(USERS_FILE, { users }));
const saveSistemas = () => serial(() => writeJsonAtomic(SISTEMAS_FILE, sistemas));

async function loadAll() {
  ensureDataDir();
  if (!existsSync(SECRET_FILE)) writeFileSync(SECRET_FILE, crypto.randomBytes(32), { mode: 0o600 });
  SECRET = readFileSync(SECRET_FILE);

  if (!existsSync(USERS_FILE)) {
    const now = new Date().toISOString();
    users = [{ ...SEED_ADMIN, active: true, sv: 0, created_at: now, updated_at: now, last_login: null }];
    await saveUsers();
    console.log(`[portal] usuários criados em ${USERS_FILE} (admin: ${SEED_ADMIN.username})`);
  } else {
    users = JSON.parse(await fs.readFile(USERS_FILE, "utf8")).users || [];
  }

  if (!existsSync(SISTEMAS_FILE)) {
    sistemas = JSON.parse(await fs.readFile(SISTEMAS_SEED, "utf8"));
    const now = new Date().toISOString();
    sistemas.sistemas = sistemas.sistemas.map((s) => ({ ativo: true, criado_em: now, ...s }));
    await saveSistemas();
  } else {
    sistemas = JSON.parse(await fs.readFile(SISTEMAS_FILE, "utf8"));
  }
}

const findUser = (u) => users.find((x) => x.username === String(u || "").trim().toLowerCase());
const findSistema = (id) => sistemas.sistemas.find((s) => s.id === id);
const isAdmin = (u) => u.role === "administrador";
const activeAdmins = () => users.filter((u) => isAdmin(u) && u.active);
const canSee = (u, id) => isAdmin(u) || (u.sistemas || []).includes("*") || (u.sistemas || []).includes(id);

const publicUser = (u) => ({
  username: u.username, name: u.name, role: u.role, sistemas: u.sistemas, active: u.active,
  created_at: u.created_at, updated_at: u.updated_at, last_login: u.last_login,
});

// ================================================================ auditoria
function audit(event, req, extra = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ip: clientIp(req), ...extra });
  fs.appendFile(AUDIT_FILE, line + "\n", { mode: 0o600 }).catch(() => {});
}

async function readAudit() {
  try {
    const txt = await fs.readFile(AUDIT_FILE, "utf8");
    return txt.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// Acesso via SSO do nginx acontece a cada requisição; registra no máximo 1 a cada 30 min por usuário+sistema.
const ssoSeen = new Map();
function auditSso(req, username, sistema) {
  const k = `${username}|${sistema}`;
  const now = Date.now();
  if ((ssoSeen.get(k) || 0) > now - 30 * 60_000) return;
  ssoSeen.set(k, now);
  audit("sso_acesso", req, { username, sistema });
}

// ================================================================ sessões (token assinado)
// Token = base64url(JSON {u, sv, exp}) + "." + HMAC-SHA256. Sobrevive a reinícios.
// Revogação: "sv" (versão de sessão) do usuário sobe ao trocar senha, desativar ou "derrubar sessões".
function signToken(user, ttlMs) {
  const payload = Buffer.from(JSON.stringify({ u: user.username, sv: user.sv || 0, exp: Date.now() + ttlMs })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function readToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (d.exp < Date.now()) return null;
    const user = findUser(d.u);
    if (!user || !user.active || (user.sv || 0) !== d.sv) return null;
    return { user, exp: d.exp };
  } catch { return null; }
}

function sessionFromReq(req) {
  return readToken(parseCookies(req)[COOKIE]);
}

function bearer(req) {
  const h = String(req.headers.authorization || "");
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

// ================================================================ bloqueio por tentativas
const attempts = new Map();
const LOCK_MS = 15 * 60_000;
function lockedAny(keys) { const now = Date.now(); return keys.some((k) => (attempts.get(k)?.until || 0) > now); }
function failAll(keys) {
  const now = Date.now();
  for (const k of keys) {
    let a = attempts.get(k);
    if (!a || a.first + LOCK_MS < now) a = { count: 0, first: now, until: 0 };
    a.count += 1;
    if (a.count >= 5) { a.until = now + LOCK_MS; a.count = 0; a.first = now; }
    attempts.set(k, a);
  }
}
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of attempts) if (a.until < now && a.first + LOCK_MS < now) attempts.delete(k);
  for (const [k, t] of ssoSeen) if (t < now - 30 * 60_000) ssoSeen.delete(k);
}, 60_000).unref();

async function checkCredentials(req, username, password) {
  username = String(username || "").trim().toLowerCase();
  const keys = [`ip:${clientIp(req)}`, `user:${username}`];
  if (lockedAny(keys)) return { error: "Muitas tentativas. Aguarde 15 minutos e tente de novo.", status: 429, username };
  const user = findUser(username);
  const ok = verifyPassword(String(password || ""), user ? user.password_hash : DUMMY_HASH) && user && user.active;
  if (!ok) { failAll(keys); return { error: "Usuário ou senha incorretos.", status: 401, username }; }
  keys.forEach((k) => attempts.delete(k));
  // Hash importado (pbkdf2): regrava em scrypt no primeiro login.
  if (!user.password_hash.startsWith("scrypt$")) user.password_hash = hashPassword(String(password));
  user.last_login = new Date().toISOString();
  await saveUsers();
  return { user };
}

// ================================================================ http util
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch {} }
  }
  return out;
}

function clientIp(req) {
  const xr = String(req.headers["x-real-ip"] || "").trim();
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xr || xf || req.socket.remoteAddress || "";
}

function isHttps(req) {
  if (/^(1|true|sim)$/i.test(COOKIE_SECURE)) return true;
  if (/^(0|false|nao|não)$/i.test(COOKIE_SECURE)) return false;
  return req.headers["x-forwarded-proto"] === "https" || !!req.socket.encrypted;
}

function sessionCookie(req, token, maxAgeSec) {
  return [
    `${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax",
    maxAgeSec === null ? "" : `Max-Age=${maxAgeSec}`,
    COOKIE_DOMAIN ? `Domain=${COOKIE_DOMAIN}` : "",
    isHttps(req) ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const json = (res, status, data, headers = {}) =>
  send(res, status, JSON.stringify(data), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
const redirect = (res, location, headers = {}) => send(res, 302, "", { Location: location, "Cache-Control": "no-store", ...headers });
const text = (res, status, msg) => send(res, status, msg, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw httpError(413, "Requisição grande demais.");
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (String(req.headers["content-type"] || "").includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try { return JSON.parse(raw || "{}"); } catch { throw httpError(400, "JSON inválido."); }
}

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

// CSRF: toda escrita do navegador exige o cabeçalho X-Portal (outro site não consegue
// enviá-lo num formulário) e, quando há Origin, ele precisa ser o próprio portal.
function csrfOk(req) {
  if (req.headers["x-portal"] !== "1") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// Destino de volta depois do login: caminho interno, ou URL de um sistema cadastrado e ativo.
function safeVolta(v) {
  v = String(v || "");
  if (!v) return "/";
  if (v.startsWith("/") && !v.startsWith("//") && !/[\\\r\n]/.test(v)) return v;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "/";
    const ok = sistemas.sistemas.some((s) => { try { return s.ativo && new URL(s.url).origin === u.origin; } catch { return false; } });
    return ok ? u.toString() : "/";
  } catch { return "/"; }
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
};

async function serveFile(res, rel) {
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return text(res, 404, "Não encontrado");
  try {
    const data = await fs.readFile(file);
    const ext = path.extname(file);
    send(res, 200, data, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300",
    });
  } catch { text(res, 404, "Não encontrado"); }
}

// ================================================================ validação de cadastro
function cleanSistemasList(list) {
  if (!Array.isArray(list)) return [];
  if (list.includes("*")) return ["*"];
  const valid = new Set(sistemas.sistemas.map((s) => s.id));
  return [...new Set(list.filter((id) => valid.has(id)))];
}

const TIPOS = ["painel", "tv", "documentacao", "ia", "site", "aplicacao"];
const SSO_MODOS = ["nginx", "api", "nenhum"];

function validarSistema(body, atual) {
  const s = { ...(atual || {}) };
  if (!atual) {
    const id = String(body.id || "").trim().toLowerCase();
    if (!ID_RE.test(id)) throw httpError(400, "Identificador inválido: use 2 a 40 letras minúsculas, números e hífen.");
    if (findSistema(id)) throw httpError(409, "Já existe um sistema com esse identificador.");
    s.id = id;
    s.criado_em = new Date().toISOString();
  }
  const nome = String(body.nome ?? s.nome ?? "").trim();
  if (!nome) throw httpError(400, "Informe o nome.");
  s.nome = nome.slice(0, 80);
  s.descricao = String(body.descricao ?? s.descricao ?? "").trim().slice(0, 200);
  let url;
  try { url = new URL(String(body.url ?? s.url ?? "").trim()); } catch { throw httpError(400, "Destino inválido: informe a URL completa, com https://"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw httpError(400, "O destino precisa começar com http:// ou https://");
  s.url = url.toString();
  s.porta = url.port ? Number(url.port) : null;
  s.grupo = String(body.grupo ?? s.grupo ?? "outros").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40) || "outros";
  s.tipo = TIPOS.includes(body.tipo) ? body.tipo : s.tipo || "painel";
  s.icone = String(body.icone ?? s.icone ?? s.tipo).slice(0, 20);
  s.sso = SSO_MODOS.includes(body.sso) ? body.sso : s.sso || "nenhum";
  s.ativo = body.ativo === undefined ? s.ativo !== false : !!body.ativo;
  s.repo = String(body.repo ?? s.repo ?? "").trim().slice(0, 60);
  s.atualizado_em = new Date().toISOString();
  if (!sistemas.grupos.some((g) => g.id === s.grupo)) {
    sistemas.grupos.push({ id: s.grupo, nome: s.grupo.charAt(0).toUpperCase() + s.grupo.slice(1), descricao: "" });
  }
  return s;
}

// ================================================================ status e estatísticas
let statusCache = { at: 0, data: {} };
async function checkStatus() {
  if (Date.now() - statusCache.at < 60_000) return statusCache.data;
  const entries = await Promise.all(sistemas.sistemas.map(async (s) => {
    const t0 = Date.now();
    try {
      const r = await fetch(s.url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      r.body?.cancel?.().catch(() => {});
      return [s.id, { online: r.status < 500, http: r.status, ms: Date.now() - t0 }];
    } catch (e) {
      return [s.id, { online: false, erro: e.name === "TimeoutError" ? "tempo esgotado" : "sem resposta" }];
    }
  }));
  statusCache = { at: Date.now(), data: Object.fromEntries(entries) };
  return statusCache.data;
}

const ACESSO_EVENTS = new Set(["abrir_sistema", "sso_acesso", "sso_login_api"]);
const diaSP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

async function estatisticas(dias) {
  const eventos = await readAudit();
  const desde = Date.now() - dias * 86400_000;
  const porDia = {};
  for (let i = dias - 1; i >= 0; i--) porDia[diaSP.format(new Date(Date.now() - i * 86400_000))] = 0;
  const porSistema = {};
  const porUsuario = {};
  let logins = 0, falhas = 0;
  for (const e of eventos) {
    const t = Date.parse(e.ts);
    if (!(t >= desde)) continue;
    if (e.event === "login") logins++;
    if (e.event === "login_falhou") falhas++;
    if (!ACESSO_EVENTS.has(e.event)) continue;
    const d = diaSP.format(new Date(t));
    if (d in porDia) porDia[d]++;
    porSistema[e.sistema] = (porSistema[e.sistema] || 0) + 1;
    porUsuario[e.username] = (porUsuario[e.username] || 0) + 1;
  }
  return {
    dias,
    total: Object.values(porDia).reduce((a, b) => a + b, 0),
    logins, falhas,
    serie: Object.entries(porDia).map(([dia, acessos]) => ({ dia, acessos })),
    porSistema, porUsuario,
  };
}

// ================================================================ rotas
async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  const method = req.method;

  if (p === "/healthz") return text(res, 200, "ok");

  if (method === "GET" && (p.startsWith("/assets/") || p.startsWith("/css/") || p.startsWith("/js/") || p === "/favicon.ico")) {
    return serveFile(res, p);
  }

  // ------------------------------------------------ SSO para o nginx (auth_request)
  // 204 = liberado (com X-Portal-User), 401 = sem sessão, 403 = sem permissão para o sistema.
  if (p === "/sso/verificar" && (method === "GET" || method === "HEAD")) {
    const sid = url.searchParams.get("sistema") || req.headers["x-portal-sistema"] || "";
    const s = findSistema(String(sid));
    const sess = sessionFromReq(req);
    if (!sess) return send(res, 401, "", { "Cache-Control": "no-store" });
    if (!s || !s.ativo || !canSee(sess.user, s.id)) return send(res, 403, "", { "Cache-Control": "no-store" });
    auditSso(req, sess.user.username, s.id);
    return send(res, 204, "", {
      "Cache-Control": "no-store",
      "X-Portal-User": sess.user.username,
      "X-Portal-Name": encodeURIComponent(sess.user.name || sess.user.username),
      "X-Portal-Role": sess.user.role,
    });
  }

  // Entrada a partir de um sistema: /sso/entrar?sistema=olts&volta=https://monitoramento...:8443/
  if (p === "/sso/entrar" && method === "GET") {
    const volta = safeVolta(url.searchParams.get("volta"));
    const sid = url.searchParams.get("sistema") || "";
    const sess = sessionFromReq(req);
    if (!sess) return redirect(res, `/login?sistema=${encodeURIComponent(sid)}&volta=${encodeURIComponent(volta)}`);
    const s = findSistema(sid);
    if (s && !canSee(sess.user, s.id)) return redirect(res, `/?negado=${encodeURIComponent(s.id)}`);
    return redirect(res, volta);
  }

  // Sair a partir de um sistema: /sso/sair?volta=...
  if (p === "/sso/sair" && method === "GET") {
    const sess = sessionFromReq(req);
    if (sess) audit("logout", req, { username: sess.user.username });
    return redirect(res, "/login?saiu=1", { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  // ------------------------------------------------ API compatível com o login do sistema NOC (IA NOC)
  const sso = p.match(/^\/sso\/([a-z0-9-]+)\/api\/auth\/(login|me|logout)$/);
  if (sso) {
    const s = findSistema(sso[1]);
    if (!s || !s.ativo) return json(res, 404, { error: "Sistema não cadastrado no portal." });
    if (sso[2] === "login" && method === "POST") {
      const body = await readJson(req);
      const r = await checkCredentials(req, body.username, body.password);
      if (r.error) { audit("login_falhou", req, { username: r.username, sistema: s.id }); return json(res, r.status, { error: r.error }); }
      if (!canSee(r.user, s.id)) { audit("acesso_negado", req, { username: r.user.username, sistema: s.id }); return json(res, 403, { error: "Sem acesso a este sistema." }); }
      audit("sso_login_api", req, { username: r.user.username, sistema: s.id });
      return json(res, 200, {
        token: signToken(r.user, SESSION_HORAS * 3600_000),
        user: { id: r.user.username, username: r.user.username, display_name: r.user.name, role: r.user.role, must_change_password: false },
      });
    }
    if (sso[2] === "me" && method === "GET") {
      const t = readToken(bearer(req));
      if (!t || !canSee(t.user, s.id)) return json(res, 401, { error: "Sessão inválida." });
      return json(res, 200, { user: { id: t.user.username, username: t.user.username, display_name: t.user.name, role: t.user.role } });
    }
    if (sso[2] === "logout" && method === "POST") return json(res, 200, { ok: true });
    return json(res, 405, { error: "Método não permitido." });
  }

  const session = sessionFromReq(req);

  if (method === "GET" && (p === "/login" || p === "/login.html")) {
    if (session) return redirect(res, safeVolta(url.searchParams.get("volta")));
    return serveFile(res, "/login.html");
  }

  // ------------------------------------------------ login do portal
  if (p === "/api/login" && method === "POST") {
    if (!csrfOk(req)) return json(res, 403, { error: "Requisição recusada." });
    const body = await readJson(req);
    const r = await checkCredentials(req, body.username, body.password);
    if (r.error) { audit(r.status === 429 ? "login_bloqueado" : "login_falhou", req, { username: r.username }); return json(res, r.status, { error: r.error }); }
    const lembrar = !!body.lembrar;
    const ttl = lembrar ? LEMBRAR_DIAS * 86400_000 : SESSION_HORAS * 3600_000;
    audit("login", req, { username: r.user.username, lembrar });
    return json(res, 200, { user: publicUser(r.user), volta: safeVolta(body.volta) }, {
      "Set-Cookie": sessionCookie(req, signToken(r.user, ttl), lembrar ? Math.floor(ttl / 1000) : null),
    });
  }

  if (p === "/api/logout" && method === "POST") {
    if (session) audit("logout", req, { username: session.user.username });
    return json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
  }

  // ------------------------------------------------ daqui pra baixo, só com sessão
  if (!session) {
    if (p.startsWith("/api/")) return json(res, 401, { error: "Sessão expirada. Entre novamente." });
    const volta = p === "/" ? "" : `?volta=${encodeURIComponent(p + url.search)}`;
    return redirect(res, `/login${volta}`);
  }
  const me = session.user;
  const admin = isAdmin(me);

  if (method !== "GET" && method !== "HEAD" && !csrfOk(req)) return json(res, 403, { error: "Requisição recusada." });

  if (method === "GET" && (p === "/" || p === "/index.html")) return serveFile(res, "/index.html");

  // Concentrador: /ir/<id> registra o acesso e redireciona
  const ir = p.match(/^\/ir\/([a-z0-9-]+)$/);
  if (ir && method === "GET") {
    const s = findSistema(ir[1]);
    if (!s || !s.ativo) return text(res, 404, "Sistema não encontrado ou inativo.");
    if (!canSee(me, s.id)) { audit("acesso_negado", req, { username: me.username, sistema: s.id }); return redirect(res, `/?negado=${s.id}`); }
    audit("abrir_sistema", req, { username: me.username, sistema: s.id });
    return redirect(res, s.url);
  }

  if (p === "/api/me" && method === "GET") return json(res, 200, { user: publicUser(me), perfis: PERFIS, portal: PORTAL_URL || null });

  if (p === "/api/me/password" && method === "POST") {
    const body = await readJson(req);
    if (!verifyPassword(String(body.atual || ""), me.password_hash)) throw httpError(400, "A senha atual não confere.");
    const nova = String(body.nova || "");
    if (nova.length < MIN_PASSWORD) throw httpError(400, `A nova senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
    me.password_hash = hashPassword(nova);
    me.sv = (me.sv || 0) + 1;
    me.updated_at = new Date().toISOString();
    await saveUsers();
    audit("senha_alterada", req, { username: me.username });
    return json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, signToken(me, SESSION_HORAS * 3600_000), null) });
  }

  if (p === "/api/sistemas" && method === "GET") {
    const lista = admin ? sistemas.sistemas : sistemas.sistemas.filter((s) => s.ativo && canSee(me, s.id));
    return json(res, 200, { grupos: sistemas.grupos, sistemas: lista, tipos: TIPOS, sso: SSO_MODOS });
  }

  if (p === "/api/status" && method === "GET") {
    const st = await checkStatus();
    return json(res, 200, { status: Object.fromEntries(Object.entries(st).filter(([id]) => canSee(me, id))) });
  }

  // ------------------------------------------------ administração
  const adminRoute = p.startsWith("/api/users") || p.startsWith("/api/admin/") || (p.startsWith("/api/sistemas") && method !== "GET");
  if (adminRoute && !admin) return json(res, 403, { error: "Só administradores." });

  if (p === "/api/admin/stats" && method === "GET") {
    const dias = Math.min(Math.max(Number(url.searchParams.get("dias")) || 30, 1), 365);
    return json(res, 200, await estatisticas(dias));
  }

  if (p === "/api/admin/logs" && method === "GET") {
    const limite = Math.min(Number(url.searchParams.get("limite")) || 500, 5000);
    const usuario = url.searchParams.get("usuario") || "";
    const evento = url.searchParams.get("evento") || "";
    const sistema = url.searchParams.get("sistema") || "";
    const ev = (await readAudit()).reverse()
      .filter((e) => (!usuario || e.username === usuario) && (!evento || e.event === evento) && (!sistema || e.sistema === sistema))
      .slice(0, limite);
    return json(res, 200, { eventos: ev });
  }

  // Sistemas / redirecionamentos
  if (p === "/api/sistemas" && method === "POST") {
    const s = validarSistema(await readJson(req), null);
    sistemas.sistemas.push(s);
    await saveSistemas();
    statusCache.at = 0;
    audit("sistema_criado", req, { username: me.username, sistema: s.id });
    return json(res, 201, { sistema: s });
  }
  const sm = p.match(/^\/api\/sistemas\/([a-z0-9-]+)$/);
  if (sm) {
    const atual = findSistema(sm[1]);
    if (!atual) throw httpError(404, "Sistema não encontrado.");
    if (method === "PUT") {
      const s = validarSistema(await readJson(req), atual);
      Object.assign(atual, s);
      await saveSistemas();
      statusCache.at = 0;
      audit("sistema_alterado", req, { username: me.username, sistema: atual.id });
      return json(res, 200, { sistema: atual });
    }
    if (method === "DELETE") {
      sistemas.sistemas = sistemas.sistemas.filter((x) => x !== atual);
      for (const u of users) if (Array.isArray(u.sistemas)) u.sistemas = u.sistemas.filter((id) => id !== atual.id);
      await saveSistemas();
      await saveUsers();
      audit("sistema_excluido", req, { username: me.username, sistema: atual.id });
      return json(res, 200, { ok: true });
    }
  }

  // Usuários
  if (p === "/api/users" && method === "GET") return json(res, 200, { users: users.map(publicUser), perfis: PERFIS });

  if (p === "/api/users" && method === "POST") {
    const body = await readJson(req);
    const username = String(body.username || "").trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw httpError(400, "Login inválido: use 2 a 40 caracteres entre letras minúsculas, números, ponto, hífen e sublinhado.");
    if (findUser(username)) throw httpError(409, "Já existe um usuário com esse login.");
    const password = String(body.password || "");
    if (password.length < MIN_PASSWORD) throw httpError(400, `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
    const now = new Date().toISOString();
    const u = {
      username,
      name: String(body.name || "").trim().slice(0, 80) || username,
      role: PERFIS.includes(body.role) ? body.role : "analista",
      sistemas: cleanSistemasList(body.sistemas),
      active: body.active !== false,
      sv: 0,
      password_hash: hashPassword(password),
      created_at: now, updated_at: now, last_login: null,
    };
    users.push(u);
    await saveUsers();
    audit("usuario_criado", req, { username: me.username, alvo: username });
    return json(res, 201, { user: publicUser(u) });
  }

  const um = p.match(/^\/api\/users\/([a-z0-9._-]+)(\/derrubar)?$/);
  if (um) {
    const target = findUser(um[1]);
    if (!target) throw httpError(404, "Usuário não encontrado.");
    const self = target.username === me.username;

    if (um[2] && method === "POST") {
      target.sv = (target.sv || 0) + 1;
      await saveUsers();
      audit("sessoes_derrubadas", req, { username: me.username, alvo: target.username });
      const headers = self ? { "Set-Cookie": sessionCookie(req, signToken(target, SESSION_HORAS * 3600_000), null) } : {};
      return json(res, 200, { ok: true }, headers);
    }

    if (!um[2] && method === "PUT") {
      const body = await readJson(req);
      const role = body.role === undefined ? target.role : PERFIS.includes(body.role) ? body.role : target.role;
      const active = body.active === undefined ? target.active : !!body.active;
      if (self && (role !== "administrador" || !active)) throw httpError(400, "Você não pode tirar o próprio acesso de administrador.");
      if (isAdmin(target) && target.active && (role !== "administrador" || !active) && activeAdmins().length <= 1) {
        throw httpError(400, "Precisa sobrar pelo menos um administrador ativo.");
      }
      if (body.name !== undefined) target.name = String(body.name).trim().slice(0, 80) || target.username;
      if (body.sistemas !== undefined) target.sistemas = cleanSistemasList(body.sistemas);
      const revoga = (!active && target.active) || !!body.password;
      target.role = role;
      target.active = active;
      if (body.password) {
        if (String(body.password).length < MIN_PASSWORD) throw httpError(400, `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
        target.password_hash = hashPassword(String(body.password));
      }
      if (revoga) target.sv = (target.sv || 0) + 1;
      target.updated_at = new Date().toISOString();
      await saveUsers();
      audit("usuario_alterado", req, { username: me.username, alvo: target.username, senha: !!body.password });
      const headers = self && revoga ? { "Set-Cookie": sessionCookie(req, signToken(target, SESSION_HORAS * 3600_000), null) } : {};
      return json(res, 200, { user: publicUser(target) }, headers);
    }

    if (!um[2] && method === "DELETE") {
      if (self) throw httpError(400, "Você não pode excluir o próprio usuário.");
      if (isAdmin(target) && target.active && activeAdmins().length <= 1) throw httpError(400, "Precisa sobrar pelo menos um administrador ativo.");
      users = users.filter((u) => u !== target);
      await saveUsers();
      audit("usuario_excluido", req, { username: me.username, alvo: target.username });
      return json(res, 200, { ok: true });
    }
  }

  if (p.startsWith("/api/")) return json(res, 404, { error: "Rota não encontrada." });
  return redirect(res, "/");
}

// ================================================================ start / linha de comando
export async function start({ port = PORT, host = HOST } = {}) {
  await loadAll();
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) json(res, status, { error: status === 500 ? "Erro interno." : err.message });
    });
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  console.log(`[portal] ouvindo em http://${host}:${server.address().port}`);
  return server;
}

// node server.mjs importar-painel-auth /etc/painel-olt/users.json
// Traz os usuários do login do Painel das OLTs (nocup) mantendo as senhas atuais.
async function importarPainelAuth(arquivo) {
  await loadAll();
  const origem = JSON.parse(await fs.readFile(arquivo, "utf8"));
  let novos = 0;
  for (const [nome, info] of Object.entries(origem)) {
    const username = nome.toLowerCase();
    if (findUser(username) || !info?.hash) { console.log(`- ${username}: já existe, mantido`); continue; }
    const now = new Date().toISOString();
    users.push({ username, name: username, role: "analista", sistemas: ["*"], active: true, sv: 0,
      password_hash: info.hash, created_at: now, updated_at: now, last_login: null });
    novos++;
    console.log(`+ ${username}: importado (perfil analista, todos os sistemas)`);
  }
  await saveUsers();
  console.log(`${novos} usuário(s) importado(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "importar-painel-auth") importarPainelAuth(arg || "/etc/painel-olt/users.json").catch((e) => { console.error(e.message); process.exit(1); });
  else start().catch((e) => { console.error(e); process.exit(1); });
}
