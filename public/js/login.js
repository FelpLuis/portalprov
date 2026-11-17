(function () {
  const $ = (id) => document.getElementById(id);
  const form = $("loginForm"), error = $("error"), submit = $("submit");
  const q = new URLSearchParams(location.search);
  const volta = q.get("volta") || "/";

  if (q.has("saiu")) $("saiu").hidden = false;
  if (/^https?:\/\//.test(volta)) {
    try {
      const u = new URL(volta);
      $("destino").innerHTML = "Depois de entrar você volta para <strong></strong>";
      $("destino").querySelector("strong").textContent = u.host + (u.pathname !== "/" ? u.pathname : "");
      $("destino").hidden = false;
    } catch {}
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hidden = true;
    const username = form.username.value.trim().toLowerCase();
    const password = form.password.value;
    if (!username || !password) { error.textContent = "Preencha usuário e senha."; error.hidden = false; return; }
    submit.disabled = true;
    submit.textContent = "Entrando…";
    try {
      // O servidor só devolve um destino interno ou de um sistema cadastrado.
      const r = await Portal.api("/api/login", { method: "POST", body: { username, password, lembrar: $("lembrar").checked, volta } });
      location.replace(r.volta || "/");
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      form.password.select();
      submit.disabled = false;
      submit.textContent = "Entrar";
    }
  });
})();
