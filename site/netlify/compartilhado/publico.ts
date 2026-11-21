/**
 * Fieldo · v12.31 · topo, rodapé e fontes das páginas de quem contrata.
 * v12.33 · e o símbolo com o ponto dourado e a imagem de compartilhamento.
 *
 * Auditoria de UX/UI (04/11): o Explorar, a página do Litoral Norte, as
 * páginas "profissão em cidade", Como contratar e Sobre tinham, cada uma,
 * o seu topo, o seu rodapé e a sua carga de fontes. Daqui sai a versão
 * única. As páginas estáticas (explorar.html, como-contratar.html,
 * sobre.html) recebem o MESMO texto entre os marcadores
 * <!-- @@TOPO --> … <!-- /@@TOPO --> e <!-- @@RODAPE --> … <!-- /@@RODAPE -->;
 * o teste confere que não divergiram.
 *
 * Mora fora de netlify/edge-functions/ de propósito: lá todo arquivo é
 * tratado como edge function e este não é uma. Só é
 * importado por regiao.ts, lista-local.ts e explorar-seo.ts.
 */

export type Atual = "explorar" | "regiao" | "como" | "sobre" | "";

/* A mesma carga de fontes do app (painel, perfil, explorar): um arquivo
   só no cache do navegador para o site inteiro. */
export const FONTES =
  `<link rel="preconnect" href="https://fonts.googleapis.com"/>\n` +
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>\n` +
  `<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,600;1,9..144,300;1,9..144,400&family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"/>\n` +
  `<link rel="stylesheet" href="/fieldo.css"/>\n` +
  `<link rel="stylesheet" href="/publico.css"/>`;

/* v12.33 · o símbolo ("o lote aberto") ganhou o ponto dourado no vão: o
   vão passa a ser de propósito e repete o "o" dourado do nome. O ponto
   tem cor própria (fill no atributo, para as páginas que não carregam
   o fieldo.css; .logo-ponto ajusta no tema claro, em publico.css). */
export const SIMBOLO =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.6 4 H15 A5 5 0 0 1 20 9 V15 A5 5 0 0 1 15 20 H9 A5 5 0 0 1 4 15 V9 A5 5 0 0 1 9 4"/><circle class="logo-ponto" cx="11.8" cy="4" r="1.2" fill="#c49a30" stroke="none"/></svg>`;

/* v12.33 · a imagem que o WhatsApp, o Facebook e o Google mostram quando
   alguém compartilha uma página de quem contrata. Sem ela, o WhatsApp
   pegava o ícone de 180 px do app e esticava. Nome novo a cada troca de
   arquivo: o *.jpg fica 7 dias em cache (netlify.toml). */
export const IMAGEM_OG_URL = "https://fieldo-zelo.com.br/og-contratar.jpg";
export const IMAGEM_OG =
  `<meta property="og:image" content="${IMAGEM_OG_URL}"/>\n` +
  `<meta property="og:image:type" content="image/jpeg"/>\n` +
  `<meta property="og:image:width" content="1200"/>\n` +
  `<meta property="og:image:height" content="630"/>\n` +
  `<meta property="og:image:alt" content="Fieldo: veja o trabalho antes de chamar. Profissionais com fotos, serviços registrados e avaliações de clientes em Caraguatatuba, São Sebastião, Ilhabela e Ubatuba."/>\n` +
  `<meta name="twitter:card" content="summary_large_image"/>\n` +
  `<meta name="twitter:image" content="${IMAGEM_OG_URL}"/>`;

const marca = (classe: string) =>
  `<a href="/" class="${classe}" aria-label="Fieldo, início"><div class="logo-icon">${SIMBOLO}</div><span class="topbar-brand">Field<em>o</em></span></a>`;

const LINKS: { id: Atual; href: string; rotulo: string; pc?: boolean }[] = [
  { id: "explorar", href: "/explorar", rotulo: "Profissionais" },
  { id: "regiao", href: "/litoral-norte", rotulo: "Litoral Norte", pc: true },
  { id: "como", href: "/como-contratar", rotulo: "Como contratar", pc: true },
];

export function topoPublico(atual: Atual = ""): string {
  const links = LINKS.map((l) =>
    `<a href="${l.href}"${l.pc ? ' class="so-pc"' : ""}${l.id === atual ? ' aria-current="page"' : ""}>${l.rotulo}</a>`).join("");
  return `<header class="topbar">
  <div class="topbar-inner">
    ${marca("topbar-logo")}
    <nav class="pub-links" aria-label="Principal">${links}<a class="pub-entrar" href="/entrar.html?entrar=1" data-pub-entrar>Entrar</a></nav>
  </div>
</header>`;
}

/* v12.36 · o rodapé leva o bloco legal (dados-legais.js), o aviso de
   cookies (consentimento.js) e o ajuste de teclado (a11y.js) para todas
   as páginas montadas por edge function: lista local, região, vitrine. */
export function rodapePublico(): string {
  return `<footer class="pub-pe">
  <div class="pub-pe-in">
    ${marca("pub-pe-marca")}
    <nav aria-label="Rodapé">
      <a href="/explorar">Profissionais</a>
      <a href="/litoral-norte">Litoral Norte</a>
      <a href="/como-contratar">Como contratar</a>
      <a href="/sobre">Sobre o Fieldo</a>
      <a href="/verificar.html">Verificar um documento</a>
      <a href="https://www.instagram.com/fieldo.zelo/" target="_blank" rel="noopener me">Instagram</a>
      <a href="/entrar.html?criar=1">Sou profissional</a>
      <a href="/termos">Termos de Uso</a>
      <a href="/privacidade">Privacidade</a>
    </nav>
    <small>Contato direto com o profissional, sem intermediação.</small>
    <div class="pub-pe-legal" data-legal="rodape"></div>
  </div>
</footer>
<script src="/dados-legais.js" defer></script>
<script src="/consentimento.js" defer></script>
<script src="/a11y.js" defer></script>`;
}

/* Para quem já tem conta, "Entrar" vira "Meu painel". Roda no navegador,
   lendo a mesma chave que o db.js grava; sem ela, nada muda. */
export const SCRIPT_ENTRAR = `<script>
(function () {
  try {
    var a = JSON.parse(localStorage.getItem('fieldo_auth') || 'null');
    if (!a || !a.access_token) return;
    var el = document.querySelector('[data-pub-entrar]');
    if (el) { el.textContent = 'Meu painel'; el.setAttribute('href', '/painel.html'); }
  } catch (e) {}
})();
</script>`;
