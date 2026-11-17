// Tema claro/escuro. Carregado no <head> para aplicar o tema antes de desenhar a página.
// Sem escolha salva, segue o tema do sistema operacional.
(function () {
  var KEY = "portal-tema";
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function salvo() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function aplicar(t) {
    root.setAttribute("data-theme", t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#070a1c" : "#140075");
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.setAttribute("aria-label", t === "dark" ? "Mudar para o modo claro" : "Mudar para o modo escuro");
      b.title = b.getAttribute("aria-label");
    });
  }
  aplicar(salvo() || (mq && mq.matches ? "dark" : "light"));
  if (mq && mq.addEventListener) mq.addEventListener("change", function (e) { if (!salvo()) aplicar(e.matches ? "dark" : "light"); });
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-theme-toggle]");
    if (!b) return;
    var novo = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, novo); } catch (err) {}
    aplicar(novo);
  });
  document.addEventListener("DOMContentLoaded", function () { aplicar(root.getAttribute("data-theme")); });
})();
