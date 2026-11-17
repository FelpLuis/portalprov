import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "portal-"));
process.env.DATA_DIR = dir;
process.env.COOKIE_SECURE = "0";
const { start } = await import("../server.mjs");
let server, base;
before(async () => { server = await start({ port: 0, host: "127.0.0.1" }); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const H = { "Content-Type": "application/json", "X-Portal": "1" };
async function login(username, password) {
  const r = await fetch(`${base}/api/login`, { method: "POST", headers: H, body: JSON.stringify({ username, password }) });
  return { r, cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}

test("admin inicial entra com a senha definida", async () => {
  const { r, cookie } = await login("luis.felipe", "Tflnx155@");
  assert.equal(r.status, 200);
  assert.match(cookie, /^updown_sso=/);
  const me = await (await fetch(`${base}/api/me`, { headers: { Cookie: cookie } })).json();
  assert.equal(me.user.role, "administrador");
});

test("senha errada é recusada e login sem X-Portal é bloqueado", async () => {
  assert.equal((await login("luis.felipe", "errada123")).r.status, 401);
  const r = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(r.status, 403);
});

test("usuário criado pelo admin usa o mesmo login no SSO do nginx e na API do IA NOC", async () => {
  const { cookie: adm } = await login("luis.felipe", "Tflnx155@");
  let r = await fetch(`${base}/api/users`, { method: "POST", headers: { ...H, Cookie: adm },
    body: JSON.stringify({ username: "joao.silva", name: "João Silva", password: "senha-forte-1", role: "analista", sistemas: ["olts", "ianoc"] }) });
  assert.equal(r.status, 201);

  const { cookie } = await login("joao.silva", "senha-forte-1");
  // nginx auth_request
  assert.equal((await fetch(`${base}/sso/verificar?sistema=olts`, { headers: { Cookie: cookie } })).status, 204);
  assert.equal((await fetch(`${base}/sso/verificar?sistema=pon`, { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await fetch(`${base}/sso/verificar?sistema=olts`)).status, 401);
  // API compatível (IA NOC)
  r = await fetch(`${base}/sso/ianoc/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "joao.silva", password: "senha-forte-1" }) });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.user.role, "analista");
  assert.equal((await fetch(`${base}/sso/ianoc/api/auth/me`, { headers: { Authorization: `Bearer ${d.token}` } })).status, 200);
  assert.equal((await fetch(`${base}/sso/links/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "joao.silva", password: "senha-forte-1" }) })).status, 403);

  // desativar corta o acesso em todas as plataformas na hora
  r = await fetch(`${base}/api/users/joao.silva`, { method: "PUT", headers: { ...H, Cookie: adm }, body: JSON.stringify({ active: false }) });
  assert.equal(r.status, 200);
  assert.equal((await fetch(`${base}/sso/verificar?sistema=olts`, { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await fetch(`${base}/sso/ianoc/api/auth/me`, { headers: { Authorization: `Bearer ${d.token}` } })).status, 401);
});

test("não deixa remover o último administrador nem redirecionar para fora", async () => {
  const { cookie: adm } = await login("luis.felipe", "Tflnx155@");
  const r = await fetch(`${base}/api/users/luis.felipe`, { method: "PUT", headers: { ...H, Cookie: adm }, body: JSON.stringify({ role: "analista" }) });
  assert.equal(r.status, 400);
  const l = await fetch(`${base}/api/login`, { method: "POST", headers: H, body: JSON.stringify({ username: "luis.felipe", password: "Tflnx155@", volta: "https://evil.example.com/" }) });
  assert.equal((await l.json()).volta, "/");
  const ok = await fetch(`${base}/api/login`, { method: "POST", headers: H, body: JSON.stringify({ username: "luis.felipe", password: "Tflnx155@", volta: "https://monitoramento.updown.com.br:8443/" }) });
  assert.equal((await ok.json()).volta, "https://monitoramento.updown.com.br:8443/");
});

test("redirecionamento /ir registra e leva ao destino", async () => {
  const { cookie } = await login("luis.felipe", "Tflnx155@");
  const r = await fetch(`${base}/ir/ianoc`, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "https://nia.updown.com.br/");
  const st = await (await fetch(`${base}/api/admin/stats?dias=7`, { headers: { Cookie: cookie } })).json();
  assert.ok(st.porSistema.ianoc >= 1);
});

test("importa hash pbkdf2 do painel-auth", async () => {
  const { verifyPassword } = await import("../server.mjs");
  // hash gerado pelo painel-auth.py (pbkdf2_sha256, base64url sem padding)
  const crypto = await import("node:crypto");
  const salt = crypto.randomBytes(16);
  const dk = crypto.pbkdf2Sync("senha-antiga", salt, 1000, 32, "sha256");
  const h = `pbkdf2_sha256$1000$${salt.toString("base64url")}$${dk.toString("base64url")}`;
  assert.ok(verifyPassword("senha-antiga", h));
  assert.ok(!verifyPassword("outra", h));
});
