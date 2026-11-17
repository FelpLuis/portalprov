// Portal NOC — aplicação (painel, redirecionamentos, usuários, logs e integrações).
(function () {
  const { api, esc, quando, agora, num, compacto, toast, icon } = Portal;
  const $ = (sel, el = document) => el.querySelector(sel);
  const view = $("#view");

  const S = { me: null, perfis: [], portal: location.origin, sistemas: [], grupos: [], tipos: [], sso: [], status: {} };

  const ROTAS = [
    { path: "/", nome: "Painel", ico: "home", render: telaPainel },
    { path: "/redirecionamentos", nome: "Redirecionamentos", ico: "link", render: telaRedirecionamentos, admin: true },
    { path: "/logs", nome: "Logs de acesso", ico: "chart", render: telaLogs, admin: true },
    { path: "/usuarios", nome: "Usuários", ico: "users", render: telaUsuarios, admin: true },
    { path: "/integracoes", nome: "Integrações", ico: "plug", render: telaIntegracoes, admin: true },
  ];
  const ROTULO_TIPO = { painel: "Painel", tv: "TV", documentacao: "Documentação", ia: "IA", site: "Site", aplicacao: "Aplicação" };
  const ROTULO_SSO = { nginx: "Login único", api: "Mesmo login (API)", nenhum: "Login próprio" };
  const ROTULO_PERFIL = { administrador: "Administrador", analista: "Analista", tecnico: "Técnico", atendimento: "Atendimento", logistica: "Logística" };
  const ROTULO_EVENTO = {
    login: "Entrou no portal", login_falhou: "Senha errada", login_bloqueado: "Bloqueado por tentativas", logout: "Saiu",
    abrir_sistema: "Abriu pelo portal", sso_acesso: "Acessou (login único)", sso_login_api: "Entrou no sistema", acesso_negado: "Acesso negado",
    senha_alterada: "Trocou a senha", usuario_criado: "Criou usuário", usuario_alterado: "Alterou usuário", usuario_excluido: "Excluiu usuário",
    sessoes_derrubadas: "Derrubou sessões", sistema_criado: "Criou redirecionamento", sistema_alterado: "Alterou redirecionamento", sistema_excluido: "Excluiu redirecionamento",
  };
  const isAdmin = () => S.me && S.me.role === "administrador";
  const nomeSistema = (id) => (S.sistemas.find((s) => s.id === id) || {}).nome || id || "—";
  const host = (url) => { try { const u = new URL(url); return u.host + (u.pathname !== "/" ? u.pathname : ""); } catch { return url; } };
  const icoDe = (s) => s.icone || s.tipo;

  // ------------------------------------------------------------ casca
  function montarCasca() {
    $("#nav").innerHTML = ROTAS.filter((r) => !r.admin || isAdmin())
      .map((r) => `<a href="#${r.path}" data-path="${r.path}">${icon(r.ico)}<span>${r.nome}</span></a>`).join("");
    const nome = S.me.name || S.me.username;
    $("#avatar").textContent = nome.split(/[\s.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
    $("#userName").textContent = nome.split(" ")[0];
    $("#menuNome").textContent = nome;
    $("#menuLogin").textContent = `${S.me.username} · ${ROTULO_PERFIL[S.me.role] || S.me.role}`;
    $("#btnSair").innerHTML = `${icon("logout")}<span>Sair</span>`;
    $("#btnMenu").innerHTML = icon("menu");

    const menu = $("#menuConta");
    $("#btnConta").addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; $("#btnConta").setAttribute("aria-expanded", String(!menu.hidden)); });
    document.addEventListener("click", (e) => { if (!menu.contains(e.target)) menu.hidden = true; if (!e.target.closest("#sidebar, #btnMenu")) $("#app").classList.remove("nav-open"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { menu.hidden = true; fecharGaveta(); } });
    $("#btnMenu").addEventListener("click", () => $("#app").classList.toggle("nav-open"));
    $("#btnSair").addEventListener("click", async () => { try { await api("/api/logout", { method: "POST" }); } catch {} location.href = "/login?saiu=1"; });

    const dlg = $("#dlgSenha");
    $("#btnSenha").addEventListener("click", () => { menu.hidden = true; $("#formSenha").reset(); $("#senhaErro").hidden = true; dlg.showModal(); });
    dlg.querySelector("[data-close]").addEventListener("click", () => dlg.close());
    $("#formSenha").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#senhaErro");
      err.hidden = true;
      if ($("#senhaNova").value !== $("#senhaNova2").value) { err.textContent = "As duas senhas novas não são iguais."; err.hidden = false; return; }
      try {
        await api("/api/me/password", { method: "POST", body: { atual: $("#senhaAtual").value, nova: $("#senhaNova").value } });
        dlg.close();
        toast("Senha alterada. Vale em todas as plataformas; as outras sessões foram encerradas.");
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });

    const tick = () => ($("#relogio").textContent = agora());
    tick(); setInterval(tick, 1000);
  }

  function confirmar(titulo, texto, ok = "Excluir") {
    const d = $("#dlgConfirma");
    $("#confTitulo").textContent = titulo; $("#confTexto").textContent = texto; $("#confOk").textContent = ok;
    d.showModal();
    return new Promise((res) => d.addEventListener("close", () => res(d.returnValue === "sim"), { once: true }));
  }

  function cabecalho(ico, titulo, sub, acoes = "") {
    return `<div class="page-head"><div class="page-icon">${icon(ico, 2)}</div><div><h1>${esc(titulo)}</h1><p>${esc(sub)}</p></div>${acoes ? `<div class="actions">${acoes}</div>` : ""}</div>`;
  }
  const stat = (cor, ico, valor, rotulo) => `<div class="stat ${cor}"><div class="ico">${icon(ico, 2.2)}</div><div><strong>${valor}</strong><span>${esc(rotulo)}</span></div></div>`;

  async function carregarSistemas() {
    const d = await api("/api/sistemas");
    Object.assign(S, { sistemas: d.sistemas, grupos: d.grupos, tipos: d.tipos, sso: d.sso });
  }
  async function carregarStatus() { try { S.status = (await api("/api/status")).status; } catch {} }

  function badgeStatus(id, ativo = true) {
    if (!ativo) return '<span class="tag tag-off"><span class="d"></span>Inativo</span>';
    const st = S.status[id];
    if (!st) return '<span class="tag tag-off">verificando…</span>';
    return st.online ? `<span class="tag tag-ok" title="HTTP ${st.http} · ${st.ms} ms"><span class="d"></span>Online</span>`
      : `<span class="tag tag-down" title="${esc(st.erro || "")}"><span class="d"></span>Fora do ar</span>`;
  }

  // ------------------------------------------------------------ roteador
  let atual = null;
  async function rotear() {
    const path = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    const rota = ROTAS.find((r) => r.path === path && (!r.admin || isAdmin())) || ROTAS[0];
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.path === rota.path));
    $("#app").classList.remove("nav-open");
    document.title = `${rota.nome} · UPDOWN NOC`;
    atual = rota;
    view.innerHTML = '<p class="muted">Carregando…</p>';
    try { await rota.render(); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    view.focus({ preventScroll: true });
  }

  // ============================================================ PAINEL
  async function telaPainel() {
    await carregarSistemas();
    const neg = new URLSearchParams(location.search).get("negado");
    const ativos = S.sistemas.filter((s) => s.ativo);
    let statsHtml = "";
    if (isAdmin()) {
      const st = await api("/api/admin/stats?dias=30");
      statsHtml = `<div class="stats">
        ${stat("blue", "globe", num(S.sistemas.length), "Sistemas cadastrados")}
        ${stat("green", "check", num(ativos.length), "Ativos")}
        ${stat("amber", "clock", num(S.sistemas.length - ativos.length), "Inativos")}
        ${stat("purple", "bars", compacto(st.total), "Acessos (últimos 30 dias)")}
      </div>`;
    }
    view.innerHTML = `
      ${cabecalho("home", "Painel", "Abra qualquer plataforma do NOC com o seu login.", `<label class="search">${icon("search")}<input id="busca" type="search" placeholder="Buscar sistema, porta ou domínio…" autocomplete="off"></label>`)}
      ${neg ? `<div class="alert">${icon("shield")}<span>Seu usuário não tem acesso a <strong>${esc(nomeSistema(neg))}</strong>. Peça a um administrador.</span></div>` : ""}
      ${statsHtml}
      <div id="grupos"></div>`;
    const desenhar = () => {
      const q = $("#busca").value.trim().toLowerCase();
      const ok = (s) => s.ativo && (!q || [s.nome, s.descricao, s.url, s.repo].join(" ").toLowerCase().includes(q));
      const html = S.grupos.map((g) => {
        const itens = S.sistemas.filter((s) => s.grupo === g.id && ok(s));
        if (!itens.length) return "";
        return `<section class="grupo"><div class="grupo-head"><h2>${esc(g.nome)}</h2><span class="muted">${esc(g.descricao || "")}</span></div>
          <div class="cards">${itens.map((s) => `
            <a class="card t-${esc(s.tipo)}" href="/ir/${esc(s.id)}" target="_blank" rel="noopener">
              <div class="card-top"><span class="card-icon">${icon(icoDe(s))}</span>${badgeStatus(s.id)}</div>
              <h3>${esc(s.nome)}</h3>
              <p>${esc(s.descricao || "")}</p>
              <div class="card-foot"><code>${esc(host(s.url))}</code><span class="abrir">Abrir ${icon("ext", 2)}</span></div>
            </a>`).join("")}</div></section>`;
      }).join("");
      $("#grupos").innerHTML = html || `<div class="empty">${q ? "Nenhum sistema encontrado." : "Você ainda não tem acesso a nenhum sistema. Fale com um administrador."}</div>`;
    };
    desenhar();
    $("#busca").addEventListener("input", desenhar);
    carregarStatus().then(() => atual?.render === telaPainel && desenhar());
  }

  // ============================================================ REDIRECIONAMENTOS
  async function telaRedirecionamentos() {
    await carregarSistemas();
    const st = await api("/api/admin/stats?dias=30");
    const ativos = S.sistemas.filter((s) => s.ativo).length;
    view.innerHTML = `
      ${cabecalho("link", "Gerenciador de Redirecionamentos", "Configure e gerencie os redirecionamentos para as plataformas do NOC.")}
      <div class="stats">
        ${stat("blue", "globe", num(S.sistemas.length), "Sistemas cadastrados")}
        ${stat("green", "check", num(ativos), "Ativos")}
        ${stat("amber", "clock", num(S.sistemas.length - ativos), "Inativos")}
        ${stat("purple", "bars", compacto(st.total), "Acessos (últimos 30 dias)")}
      </div>
      <section class="panel">
        <div class="panel-head"><h2>${icon("list", 2)}Redirecionamentos</h2>
          <div class="right"><button class="btn btn-primary" id="novo">${icon("plus", 2.2)}Novo redirecionamento</button></div></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Sistema / Link</th><th>Destino</th><th>Tipo</th><th>Status</th><th class="r">Acessos (30d)</th><th class="r">Ações</th></tr></thead>
          <tbody id="linhas"></tbody></table></div>
      </section>
      <div class="split">
        <section class="panel">
          <div class="panel-head"><h2>${icon("bars", 2)}Estatísticas de acesso</h2>
            <div class="right"><select class="input" id="periodo" style="width:auto"><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></div></div>
          <div class="panel-body"><div id="filtroSistema" class="muted" style="margin-bottom:6px"></div><div class="chart-box" id="grafico"></div><div class="bars" id="barras"></div></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>${icon("gear", 2)}<span id="formTitulo">Adicionar redirecionamento</span></h2></div>
          <form class="panel-body" id="formSis" novalidate>
            <div class="form-grid">
              <label class="field"><span>Nome <b class="req">*</b></span><input name="nome" placeholder="ex.: Painel das OLTs" required></label>
              <label class="field"><span>Identificador (link) <b class="req">*</b></span><input name="id" placeholder="ex.: olts" pattern="[a-z0-9-]+"></label>
              <label class="field full"><span>Destino <b class="req">*</b></span><input name="url" placeholder="ex.: https://monitoramento.updown.com.br:8443/" inputmode="url"></label>
              <label class="field full"><span>Descrição</span><input name="descricao" placeholder="O que o sistema mostra"></label>
              <label class="field"><span>Tipo</span><select name="tipo">${S.tipos.map((t) => `<option value="${t}">${ROTULO_TIPO[t] || t}</option>`).join("")}</select></label>
              <label class="field"><span>Grupo</span><input name="grupo" list="listaGrupos" placeholder="monitoramento"><datalist id="listaGrupos">${S.grupos.map((g) => `<option value="${esc(g.id)}">${esc(g.nome)}</option>`).join("")}</datalist></label>
              <label class="field"><span>Login</span><select name="sso">${S.sso.map((t) => `<option value="${t}">${ROTULO_SSO[t]}</option>`).join("")}</select></label>
              <div class="field"><span>Status</span><label class="switch"><input type="checkbox" name="ativo" checked><b id="lblAtivo">Ativo</b></label></div>
            </div>
            <p class="form-error" id="sisErro" hidden></p>
            <div style="display:flex;gap:10px"><button class="btn btn-primary" type="submit">${icon("save", 2)}Salvar</button>
              <button class="btn btn-light" type="button" id="cancelar">${icon("undo", 2)}Cancelar</button></div>
          </form>
        </section>
      </div>`;

    let editando = null;
    let filtro = "";
    const f = $("#formSis");
    const linhas = () => {
      $("#linhas").innerHTML = S.sistemas.length ? S.sistemas.map((s) => `
        <tr>
          <td><div class="cell-main"><span class="cell-ico">${icon(icoDe(s))}</span><div>${esc(s.nome)}<small>/ir/${esc(s.id)}</small></div></div></td>
          <td><a class="dest" title="${esc(s.url)}" href="${esc(s.url)}" target="_blank" rel="noopener">${icon("ext", 2)}<span>${esc(host(s.url))}</span></a><small class="sub-sso">${icon("shield", 2)}${esc(ROTULO_SSO[s.sso] || s.sso)}</small></td>
          <td><span class="tag tag-${esc(s.tipo)}">${esc(ROTULO_TIPO[s.tipo] || s.tipo)}</span></td>
          <td>${badgeStatus(s.id, s.ativo)}</td>
          <td class="r num">${num(st.porSistema[s.id])}</td>
          <td><div class="acoes">
            <button class="icon-btn edit" data-edit="${esc(s.id)}" title="Editar">${icon("edit", 2)}</button>
            <button class="icon-btn" data-stats="${esc(s.id)}" title="Ver acessos">${icon("bars", 2)}</button>
            <button class="icon-btn del" data-del="${esc(s.id)}" title="Excluir">${icon("trash", 2)}</button>
          </div></td>
        </tr>`).join("") : '<tr class="empty-row"><td colspan="6">Nenhum redirecionamento cadastrado.</td></tr>';
    };
    const limpar = () => {
      editando = null; f.reset(); f.id.disabled = false; f.ativo.checked = true; $("#lblAtivo").textContent = "Ativo";
      $("#formTitulo").textContent = "Adicionar redirecionamento"; $("#sisErro").hidden = true;
    };
    const editar = (id) => {
      const s = S.sistemas.find((x) => x.id === id); if (!s) return;
      editando = id;
      for (const k of ["nome", "id", "url", "descricao", "tipo", "grupo", "sso"]) f[k].value = s[k] ?? "";
      f.id.disabled = true; f.ativo.checked = s.ativo; $("#lblAtivo").textContent = s.ativo ? "Ativo" : "Inativo";
      $("#formTitulo").textContent = `Editar · ${s.nome}`; $("#sisErro").hidden = true;
      f.scrollIntoView({ behavior: "smooth", block: "center" }); f.nome.focus({ preventScroll: true });
    };
    f.ativo.addEventListener("change", () => ($("#lblAtivo").textContent = f.ativo.checked ? "Ativo" : "Inativo"));
    f.nome.addEventListener("input", () => { if (!editando && !f.id.dataset.mexeu) f.id.value = f.nome.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); });
    f.id.addEventListener("input", () => (f.id.dataset.mexeu = "1"));
    $("#cancelar").addEventListener("click", limpar);
    $("#novo").addEventListener("click", () => { limpar(); f.scrollIntoView({ behavior: "smooth", block: "center" }); f.nome.focus({ preventScroll: true }); });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = { nome: f.nome.value, url: f.url.value, descricao: f.descricao.value, tipo: f.tipo.value, grupo: f.grupo.value || "outros", sso: f.sso.value, ativo: f.ativo.checked };
      try {
        if (editando) await api(`/api/sistemas/${editando}`, { method: "PUT", body });
        else await api("/api/sistemas", { method: "POST", body: { ...body, id: f.id.value } });
        toast(editando ? "Redirecionamento atualizado." : "Redirecionamento criado.");
        await carregarSistemas(); limpar(); linhas();
      } catch (ex) { $("#sisErro").textContent = ex.message; $("#sisErro").hidden = false; }
    });
    $("#linhas").addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.edit) editar(b.dataset.edit);
      if (b.dataset.stats) { filtro = b.dataset.stats; await graficoAcessos(); $("#grafico").scrollIntoView({ behavior: "smooth", block: "center" }); }
      if (b.dataset.del) {
        const s = S.sistemas.find((x) => x.id === b.dataset.del);
        if (!(await confirmar("Excluir redirecionamento?", `"${s.nome}" sai do portal e da permissão de todos os usuários. O sistema em si não é afetado.`))) return;
        try { await api(`/api/sistemas/${s.id}`, { method: "DELETE" }); toast("Redirecionamento excluído."); await carregarSistemas(); if (editando === s.id) limpar(); linhas(); }
        catch (ex) { toast(ex.message, "erro"); }
      }
    });

    async function graficoAcessos() {
      const dias = Number($("#periodo").value);
      const d = await api(`/api/admin/stats?dias=${dias}`);
      let serie = d.serie;
      if (filtro) {
        const ev = (await api(`/api/admin/logs?limite=5000&sistema=${encodeURIComponent(filtro)}`)).eventos;
        const cont = {};
        const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
        for (const e of ev) if (["abrir_sistema", "sso_acesso", "sso_login_api"].includes(e.event)) { const k = fmt.format(new Date(e.ts)); cont[k] = (cont[k] || 0) + 1; }
        serie = serie.map((p) => ({ dia: p.dia, acessos: cont[p.dia] || 0 }));
        $("#filtroSistema").innerHTML = `Mostrando: <strong>${esc(nomeSistema(filtro))}</strong> · <a href="#" id="tirarFiltro">ver todos</a>`;
        $("#tirarFiltro").addEventListener("click", (ev2) => { ev2.preventDefault(); filtro = ""; graficoAcessos(); });
      } else $("#filtroSistema").textContent = "Todos os sistemas";
      desenharGrafico($("#grafico"), serie);
      const top = Object.entries(d.porSistema).sort((a, b) => b[1] - a[1]).slice(0, 6);
      const max = Math.max(1, ...top.map((t) => t[1]));
      $("#barras").innerHTML = top.length ? top.map(([id, v]) => `<div class="bar-row"><span>${esc(nomeSistema(id))}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%"></div></div><span class="v">${num(v)}</span></div>`).join("") : "";
    }
    $("#periodo").addEventListener("change", graficoAcessos);

    linhas(); limpar(); graficoAcessos();
    carregarStatus().then(() => atual?.render === telaRedirecionamentos && linhas());
  }

  function desenharGrafico(box, serie) {
    const W = Math.max(320, Math.round(box.clientWidth || 640)), H = 260, L = 44, R = 12, T = 14, B = 30;
    const max = Math.max(4, ...serie.map((p) => p.acessos));
    const passo = Math.pow(10, Math.floor(Math.log10(max))) / (max / Math.pow(10, Math.floor(Math.log10(max))) < 2.5 ? 2 : 1);
    const topo = Math.ceil(max / passo) * passo;
    const x = (i) => L + (serie.length > 1 ? (i / (serie.length - 1)) * (W - L - R) : 0);
    const y = (v) => T + (1 - v / topo) * (H - T - B);
    const pts = serie.map((p, i) => [x(i), y(p.acessos)]);
    const linha = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const area = `${linha} L${x(serie.length - 1)} ${H - B} L${L} ${H - B} Z`;
    const grades = []; for (let v = 0; v <= topo; v += passo) grades.push(v);
    const rot = (d) => d.slice(8, 10) + "/" + d.slice(5, 7);
    const cada = Math.max(1, Math.ceil(serie.length / 6));
    box.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Acessos por dia">
      <defs><linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0B0FEE" stop-opacity=".22"/><stop offset="1" stop-color="#0BBBEF" stop-opacity=".02"/></linearGradient></defs>
      ${grades.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${compacto(v)}</text>`).join("")}
      ${serie.map((p, i) => (i % cada === 0 || i === serie.length - 1) ? `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${rot(p.dia)}</text>` : "").join("")}
      <path class="area" d="${area}"/><path class="line" d="${linha}"/>
      ${serie.length <= 31 ? pts.map((p) => `<circle class="pt" cx="${p[0]}" cy="${p[1]}" r="3"/>`).join("") : ""}
      <line class="hover-line" id="hl" y1="${T}" y2="${H - B}" visibility="hidden"/>
    </svg><div class="chart-tip" hidden></div>`;
    const svg = box.querySelector("svg"), tip = box.querySelector(".chart-tip"), hl = box.querySelector("#hl");
    svg.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(serie.length - 1, Math.round(((vx - L) / (W - L - R)) * (serie.length - 1))));
      hl.setAttribute("x1", x(i)); hl.setAttribute("x2", x(i)); hl.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.style.left = (x(i) / W) * r.width + "px";
      tip.style.top = (y(serie[i].acessos) / H) * r.height + "px";
      tip.textContent = `${rot(serie[i].dia)} · ${num(serie[i].acessos)} acesso${serie[i].acessos === 1 ? "" : "s"}`;
    });
    svg.addEventListener("mouseleave", () => { tip.hidden = true; hl.setAttribute("visibility", "hidden"); });
  }

  // ============================================================ USUÁRIOS
  async function telaUsuarios() {
    await carregarSistemas();
    const [{ users, perfis }, st] = await Promise.all([api("/api/users"), api("/api/admin/stats?dias=30")]);
    S.perfis = perfis;
    const ativos = users.filter((u) => u.active).length;
    view.innerHTML = `
      ${cabecalho("users", "Usuários", "O login e a senha criados aqui são os mesmos usados em todas as plataformas.")}
      <div class="stats">
        ${stat("blue", "users", num(users.length), "Usuários")}
        ${stat("green", "check", num(ativos), "Ativos")}
        ${stat("amber", "clock", num(users.length - ativos), "Desativados")}
        ${stat("purple", "shield", num(users.filter((u) => u.role === "administrador").length), "Administradores")}
      </div>
      <section class="panel">
        <div class="panel-head"><h2>${icon("list", 2)}Usuários cadastrados</h2>
          <div class="right"><label class="search">${icon("search")}<input id="buscaU" type="search" placeholder="Buscar usuário…"></label>
          <button class="btn btn-primary" id="novoU">${icon("plus", 2.2)}Novo usuário</button></div></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Usuário</th><th>Perfil</th><th>Acesso</th><th>Status</th><th>Último login</th><th class="r">Acessos (30d)</th><th class="r">Ações</th></tr></thead>
          <tbody id="linhasU"></tbody></table></div>
      </section>`;

    const desenhar = () => {
      const q = $("#buscaU").value.trim().toLowerCase();
      const lista = users.filter((u) => !q || (u.username + " " + u.name).toLowerCase().includes(q));
      $("#linhasU").innerHTML = lista.length ? lista.map((u) => {
        const todos = u.role === "administrador" || (u.sistemas || []).includes("*");
        const acesso = todos ? "Todos os sistemas" : (u.sistemas || []).length ? (u.sistemas.length === 1 ? nomeSistema(u.sistemas[0]) : `${u.sistemas.length} sistemas`) : "Nenhum";
        return `<tr>
          <td><div class="cell-main"><span class="avatar">${esc((u.name || u.username).split(/[\s.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase())}</span><div>${esc(u.name)}<small>${esc(u.username)}</small></div></div></td>
          <td><span class="tag ${u.role === "administrador" ? "tag-admin" : "tag-site"}">${esc(ROTULO_PERFIL[u.role] || u.role)}</span></td>
          <td title="${esc(todos ? "" : (u.sistemas || []).map(nomeSistema).join(", "))}">${esc(acesso)}</td>
          <td>${u.active ? '<span class="tag tag-ok"><span class="d"></span>Ativo</span>' : '<span class="tag tag-off"><span class="d"></span>Desativado</span>'}</td>
          <td class="muted">${quando(u.last_login)}</td>
          <td class="r num">${num(st.porUsuario[u.username])}</td>
          <td><div class="acoes">
            <button class="icon-btn edit" data-edit="${esc(u.username)}" title="Editar">${icon("edit", 2)}</button>
            <button class="icon-btn del" data-del="${esc(u.username)}" title="Excluir" ${u.username === S.me.username ? "disabled" : ""}>${icon("trash", 2)}</button>
          </div></td></tr>`;
      }).join("") : '<tr class="empty-row"><td colspan="7">Nenhum usuário encontrado.</td></tr>';
    };
    desenhar();
    $("#buscaU").addEventListener("input", desenhar);
    const recarregar = async () => { const d = await api("/api/users"); users.splice(0, users.length, ...d.users); desenhar(); };
    $("#novoU").addEventListener("click", () => gavetaUsuario(null, recarregar));
    $("#linhasU").addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      if (b.dataset.edit) gavetaUsuario(users.find((u) => u.username === b.dataset.edit), recarregar);
      if (b.dataset.del) {
        if (!(await confirmar("Excluir usuário?", `"${b.dataset.del}" perde o acesso ao portal e a todas as plataformas imediatamente.`))) return;
        try { await api(`/api/users/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" }); toast("Usuário excluído."); recarregar(); }
        catch (ex) { toast(ex.message, "erro"); }
      }
    });
  }

  function fecharGaveta() { document.querySelectorAll(".drawer, .drawer-bg").forEach((el) => el.remove()); }

  function gavetaUsuario(u, aoSalvar) {
    fecharGaveta();
    const novo = !u;
    const marcados = new Set(u?.sistemas || []);
    const bg = document.createElement("div"); bg.className = "drawer-bg";
    const d = document.createElement("aside"); d.className = "drawer"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
    d.innerHTML = `
      <header><h2>${icon(novo ? "plus" : "user", 2)}${novo ? "Novo usuário" : esc(u.name)}</h2><button class="icon-btn" data-x aria-label="Fechar">${icon("x", 2)}</button></header>
      <form class="body" id="formU" novalidate>
        <div class="form-grid">
          <label class="field"><span>Nome <b class="req">*</b></span><input name="name" value="${esc(u?.name || "")}" placeholder="Nome e sobrenome" required></label>
          <label class="field"><span>Login <b class="req">*</b></span><input name="username" value="${esc(u?.username || "")}" placeholder="nome.sobrenome" autocapitalize="none" spellcheck="false" ${novo ? "" : "disabled"}></label>
          <label class="field"><span>Perfil</span><select name="role">${S.perfis.map((p) => `<option value="${p}" ${(u?.role || "analista") === p ? "selected" : ""}>${ROTULO_PERFIL[p] || p}</option>`).join("")}</select></label>
          <div class="field"><span>Status</span><label class="switch"><input type="checkbox" name="active" ${u?.active === false ? "" : "checked"}><b id="lblU">${u?.active === false ? "Desativado" : "Ativo"}</b></label></div>
          <label class="field full"><span>${novo ? 'Senha <b class="req">*</b>' : "Nova senha <small class=\"muted\">(deixe em branco para manter)</small>"}</span>
            <div class="pw"><input name="password" id="uSenha" type="text" autocomplete="new-password" placeholder="mínimo 8 caracteres">
            <button type="button" class="pw-toggle" id="gerar">Gerar</button></div></label>
        </div>
        <div class="field"><span>Acesso às plataformas</span>
          <div class="perm-list" id="perms">
            <label class="check all"><input type="checkbox" value="*" ${marcados.has("*") ? "checked" : ""}> <strong>Todos os sistemas</strong> <small class="muted">(inclui os que forem cadastrados depois)</small></label>
            ${S.sistemas.map((s) => `<label class="check"><input type="checkbox" value="${esc(s.id)}" ${marcados.has(s.id) ? "checked" : ""}> ${esc(s.nome)}</label>`).join("")}
          </div>
          <small class="muted" id="permNota"></small>
        </div>
        <p class="form-error" id="uErro" hidden></p>
      </form>
      <footer>
        ${novo ? "" : `<button class="btn btn-light" type="button" id="derrubar" title="Desconecta o usuário de todas as plataformas">${icon("logout", 2)}Derrubar sessões</button>`}
        <span class="grow"></span>
        <button class="btn btn-light" type="button" data-x>Cancelar</button>
        <button class="btn btn-primary" type="submit" form="formU">${icon("save", 2)}Salvar</button>
      </footer>`;
    document.body.append(bg, d);
    const f = d.querySelector("#formU");
    const perms = d.querySelector("#perms");
    const sincronizar = () => {
      const admin = f.role.value === "administrador";
      const todos = perms.querySelector('[value="*"]').checked || admin;
      perms.querySelectorAll('input:not([value="*"])').forEach((c) => (c.disabled = todos));
      perms.querySelector('[value="*"]').disabled = admin;
      d.querySelector("#permNota").textContent = admin ? "Administradores acessam todos os sistemas e gerenciam o portal." : "";
    };
    perms.addEventListener("change", sincronizar);
    f.role.addEventListener("change", sincronizar);
    sincronizar();
    f.active.addEventListener("change", () => (d.querySelector("#lblU").textContent = f.active.checked ? "Ativo" : "Desativado"));
    d.querySelector("#gerar").addEventListener("click", () => {
      const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$%";
      const r = crypto.getRandomValues(new Uint32Array(12));
      f.password.value = Array.from(r, (n) => abc[n % abc.length]).join("");
      f.password.select();
    });
    if (novo) f.name.addEventListener("input", () => {
      if (f.username.dataset.mexeu) return;
      const p = f.name.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().split(/\s+/).filter(Boolean);
      f.username.value = p.length > 1 ? `${p[0]}.${p[p.length - 1]}` : p[0] || "";
    });
    f.username.addEventListener("input", () => (f.username.dataset.mexeu = "1"));
    d.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", fecharGaveta));
    bg.addEventListener("click", fecharGaveta);
    d.querySelector("#derrubar")?.addEventListener("click", async () => {
      try { await api(`/api/users/${encodeURIComponent(u.username)}/derrubar`, { method: "POST" }); toast("Sessões encerradas em todas as plataformas."); }
      catch (ex) { toast(ex.message, "erro"); }
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = d.querySelector("#uErro"); err.hidden = true;
      const sistemas = [...perms.querySelectorAll("input:checked")].map((c) => c.value);
      const body = { name: f.name.value, role: f.role.value, active: f.active.checked, sistemas: sistemas.includes("*") ? ["*"] : sistemas };
      if (f.password.value) body.password = f.password.value;
      try {
        if (novo) {
          if (!f.password.value) throw new Error("Defina a senha do usuário.");
          await api("/api/users", { method: "POST", body: { ...body, username: f.username.value.trim().toLowerCase() } });
        } else {
          await api(`/api/users/${encodeURIComponent(u.username)}`, { method: "PUT", body });
        }
        fecharGaveta();
        toast(novo ? `Usuário criado. Ele já entra em todas as plataformas liberadas.` : "Usuário atualizado.");
        aoSalvar();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
    setTimeout(() => (novo ? f.name : f.name).focus(), 50);
  }

  // ============================================================ LOGS
  async function telaLogs() {
    await carregarSistemas();
    const st = await api("/api/admin/stats?dias=30");
    view.innerHTML = `
      ${cabecalho("chart", "Logs de acesso", "Quem entrou, em qual plataforma e quando. Horário de Brasília.")}
      <div class="stats">
        ${stat("purple", "bars", compacto(st.total), "Acessos (30 dias)")}
        ${stat("green", "check", num(st.logins), "Logins no portal")}
        ${stat("amber", "shield", num(st.falhas), "Senhas erradas")}
        ${stat("blue", "users", num(Object.keys(st.porUsuario).length), "Usuários que acessaram")}
      </div>
      <section class="panel">
        <div class="panel-head"><h2>${icon("list", 2)}Eventos</h2>
          <div class="right filters">
            <select id="fEvento"><option value="">Todos os eventos</option>${Object.entries(ROTULO_EVENTO).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
            <select id="fSistema"><option value="">Todos os sistemas</option>${S.sistemas.map((s) => `<option value="${esc(s.id)}">${esc(s.nome)}</option>`).join("")}</select>
            <input id="fUsuario" placeholder="Usuário" autocapitalize="none">
          </div></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Data e hora</th><th>Usuário</th><th>Evento</th><th>Sistema</th><th>IP</th></tr></thead><tbody id="linhasL"></tbody></table></div>
      </section>`;
    const carregar = async () => {
      const qs = new URLSearchParams({ limite: "500", evento: $("#fEvento").value, sistema: $("#fSistema").value, usuario: $("#fUsuario").value.trim().toLowerCase() });
      const { eventos } = await api(`/api/admin/logs?${qs}`);
      const cor = (e) => (["login_falhou", "login_bloqueado", "acesso_negado"].includes(e) ? "tag-down" : ["abrir_sistema", "sso_acesso", "sso_login_api", "login"].includes(e) ? "tag-ok" : "tag-site");
      $("#linhasL").innerHTML = eventos.length ? eventos.map((e) => `<tr>
        <td class="num">${quando(e.ts)}</td><td><strong>${esc(e.username || "—")}</strong>${e.alvo ? ` <span class="muted">→ ${esc(e.alvo)}</span>` : ""}</td>
        <td><span class="tag ${cor(e.event)}">${esc(ROTULO_EVENTO[e.event] || e.event)}</span></td>
        <td>${e.sistema ? esc(nomeSistema(e.sistema)) : '<span class="muted">Portal</span>'}</td><td class="muted"><code>${esc(e.ip || "")}</code></td></tr>`).join("")
        : '<tr class="empty-row"><td colspan="5">Nenhum evento com esses filtros.</td></tr>';
    };
    let t;
    ["fEvento", "fSistema"].forEach((id) => $("#" + id).addEventListener("change", carregar));
    $("#fUsuario").addEventListener("input", () => { clearTimeout(t); t = setTimeout(carregar, 300); });
    carregar();
  }

  // ============================================================ INTEGRAÇÕES
  async function telaIntegracoes() {
    await carregarSistemas();
    const portal = S.portal;
    const ph = new URL(portal).host;
    const bloco = (s) => {
      if (s.sso === "nginx") {
        return `# ${s.nome} — dentro do server { } do nginx de ${host(s.url).split("/")[0]}
include /etc/nginx/snippets/portal-sso.conf;   # uma vez por server
location / {
    auth_request /_portal_auth;
    auth_request_set $portal_user $upstream_http_x_portal_user;
    proxy_set_header X-Portal-User $portal_user;
    error_page 401 = @portal_login;
    error_page 403 = @portal_negado;
    set $portal_sistema ${s.id};
    # ... (proxy_pass / root atuais do sistema)
}`;
      }
      if (s.sso === "api") {
        return `# /etc/ianoc/ianoc.env  (com o patch integracoes/ianoc/ianoc-login-portal.patch)
# login dos usuários: o mesmo do portal
NOC_AUTH_URL=${portal}/sso/${s.id}
# dados continuam no sistema NOC
NOC_API_URL=https://sistema.updown.com.br
IANOC_ALLOWED_ROLES=administrador,analista,tecnico,atendimento,logistica`;
      }
      return "# Sem integração: o portal só redireciona; o sistema mantém o próprio login.";
    };
    view.innerHTML = `
      ${cabecalho("plug", "Integrações", "Como cada plataforma usa o login do portal.")}
      <section class="panel"><div class="panel-body">
        <p style="margin:0 0 8px"><strong>Como funciona.</strong> O portal emite um cookie de sessão para <code>.updown.com.br</code>.
        Os painéis atrás de nginx perguntam ao portal (<code>${esc(portal)}/sso/verificar</code>) se a sessão é válida e se o usuário tem acesso àquele sistema — quem já entrou no portal abre direto, quem não entrou cai na tela de login e volta para onde estava.
        O IA NOC usa a API de login do portal, então o usuário digita o mesmo login e senha.</p>
        <ol class="steps"><li>Desativar ou excluir um usuário aqui corta o acesso em todas as plataformas no mesmo instante.</li>
        <li>Trocar a senha (ou "Derrubar sessões") desconecta o usuário de todas as plataformas.</li>
        <li>Arquivos prontos ficam em <code>integracoes/</code> no repositório.</li></ol>
      </div></section>
      <div class="integ">${S.sistemas.map((s) => `
        <section class="panel" style="margin:0"><div class="panel-head"><h2><span class="cell-ico">${icon(icoDe(s))}</span>${esc(s.nome)}</h2>
          <div class="right"><span class="tag tag-sso">${esc(ROTULO_SSO[s.sso])}</span>${badgeStatus(s.id, s.ativo)}</div></div>
          <div class="panel-body"><button class="btn btn-light btn-sm copy" data-copy>Copiar</button><code>${esc(s.url)}</code><pre class="code">${esc(bloco(s))}</pre></div></section>`).join("")}
      </div>
      <p class="muted" style="margin-top:16px">Snippet comum (<code>/etc/nginx/snippets/portal-sso.conf</code>) em <code>integracoes/nginx/portal-sso.conf</code> — aponta para <code>${esc(ph)}</code>.</p>`;
    view.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => {
      navigator.clipboard?.writeText(b.parentElement.querySelector("pre").textContent).then(() => toast("Copiado."));
    }));
  }

  // ------------------------------------------------------------ início
  api("/api/me").then(async (d) => {
    S.me = d.user; S.perfis = d.perfis; if (d.portal) S.portal = d.portal;
    montarCasca();
    window.addEventListener("hashchange", rotear);
    rotear();
  });
})();
