const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const [,, outDir, anon] = process.argv;
const rid = fs.readFileSync(path.join(outDir, 'rid.txt'), 'utf8').trim();
const TEXTOS = {
  abertura: 'Feito para quem trabalha com serviço',
  antesDepois: 'Do “tá pronto” ao relatório com Pix',
  'mkt-4': 'Você escreve, o Fieldo monta',
  'mkt-5': 'Seu trabalho vira prova',
  'mkt-6': 'E vira vídeo pronto pra postar',
  'mkt-7': 'Grátis, sem cartão'
};
(async () => {
  const j = await (await fetch('http://localhost:8000/auth/v1/token?grant_type=password', { method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'fieldo.marca@demo.local', password: 'fieldo-demo-123' }) })).json();
  const sess = { access_token: j.access_token, refresh_token: j.refresh_token, user_id: j.user.id, expires_at: Date.now() + 3600e3 };
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((s) => { localStorage.setItem('fieldo_auth', JSON.stringify(s)); localStorage.setItem('fieldo_session_data', JSON.stringify({ id: s.user_id }));
    localStorage.setItem('fieldo_consent', JSON.stringify({ v: 1, ts: new Date().toISOString(), analytics: false })); }, sess);
  const page = await ctx.newPage();
  const erros = []; page.on('pageerror', (e) => erros.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text().slice(0, 240)); });
  const shot = (n) => page.screenshot({ path: path.join(outDir, 'ui-' + n + '.png') });
  const pausa = (ms) => page.waitForTimeout(ms || 350);
  await page.goto('http://localhost:8080/studio.html?r=' + rid, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-aba="midia"]', { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('.st-carregando'), null, { timeout: 60000 });
  await pausa(1200);
  // ── Mídia: todas as fotos no vídeo, capa = 1, antes = 2, depois = 3
  await page.click('[data-aba="midia"]'); await pausa();
  const fora = await page.$$eval('[data-foto][data-fora="1"]', (b) => b.map((x) => x.getAttribute('data-foto')));
  if (fora.length) { await page.click('[data-modo="incluir"]'); for (const i of fora) { await page.click(`[data-foto="${i}"]`); await pausa(200); } }
  await page.click('[data-modo="capa"]'); await page.click('[data-foto="0"]'); await pausa();
  if (!(await page.isChecked('#stAD'))) { await page.click('#stAD'); await pausa(); }
  await page.click('[data-modo="antes"]'); await page.click('[data-foto="1"]'); await pausa();
  await page.click('[data-modo="depois"]'); await page.click('[data-foto="2"]'); await pausa();
  await shot('1-midia');
  // ── Música
  await page.click('[data-aba="musica"]'); await pausa();
  await page.click('[data-trilha="pop_ensolarado"]');
  await page.waitForFunction(() => document.getElementById('stMusicaSt').textContent === '', null, { timeout: 30000 });
  await shot('2-musica');
  // ── Texto: título e estilo
  await page.click('[data-aba="texto"]'); await pausa();
  await page.click('[data-testilo="destaque"]'); await pausa();
  // ── Cenas: ordem, duração, texto, transição
  await page.click('[data-aba="cenas"]'); await pausa();
  const idsMeio = () => page.$$eval('[data-cena]', (b) => b.map((x) => x.getAttribute('data-cena')).filter((id) => id !== 'abertura' && id !== 'fechamento'));
  const chave = (id) => id === 'antesDepois' ? 'antesDepois' : (id.match(/mkt-\d/) || [id])[0];
  const alvo = ['antesDepois', 'mkt-4', 'mkt-5', 'mkt-6', 'mkt-7'];
  for (let k = 0; k < 12; k++) {
    const ids = await idsMeio(), ch = ids.map(chave);
    const i = ch.findIndex((c, p) => p > 0 && alvo.indexOf(c) < alvo.indexOf(ch[p - 1]));
    if (i < 0) break;
    await page.click(`[data-subir="${ids[i]}"]`); await pausa();
  }
  console.log('ordem:', (await idsMeio()).map(chave).join(' → '));
  const todas = await page.$$eval('[data-cena]', (b) => b.map((x) => x.getAttribute('data-cena')));
  for (const id of todas) {
    const c = chave(id); if (!TEXTOS[c]) continue;
    await page.click(`[data-cena="${id}"]`); await pausa();
    await page.fill('#stTxtCena', TEXTOS[c]); await page.dispatchEvent('#stTxtCena', 'input'); await pausa(500);
    const mais = c === 'antesDepois' ? 0 : (c === 'abertura' ? 1 : 3);   // abertura 3,1→3,6 s · fotos 2,3→3,8 s
    for (let n = 0; n < mais; n++) { await page.click('[data-dur="0.5"]'); await pausa(250); }
    if (c === 'mkt-7') { await page.selectOption('#stTransCena', 'zoom'); await pausa(); }
  }
  await shot('3-cenas');
  // ── Estilo: transição geral
  await page.click('[data-aba="estilo"]'); await page.click('[data-trans="deslizar"]'); await pausa();
  if (await page.isChecked('#stMarca')) { await page.click('#stMarca'); await pausa(); }
  console.log('marca d\'água:', await page.isChecked('#stMarca') ? 'ligada' : 'desligada');
  // ── Final: cartão, sem QR e sem link, frase própria
  await page.click('[data-aba="final"]'); await page.click('[data-fim="cartao"]'); await pausa();
  if (await page.isChecked('#stQr')) await page.click('#stQr');
  if (await page.isChecked('#stLinkFim')) await page.click('#stLinkFim');
  await page.fill('#stCham', 'Crie seu perfil grátis'); await page.dispatchEvent('#stCham', 'input'); await pausa(600);
  await shot('4-final');
  console.log('duração:', await page.textContent('#stTempo'));
  // quadros da prévia para conferir
  await page.click('#stGerar');
  await page.waitForSelector('.st-pronto video', { timeout: 300000 });
  const arq = await page.evaluate(async () => {
    const v = document.querySelector('.st-pronto video'); const b = await (await fetch(v.src)).blob(); const u = new Uint8Array(await b.arrayBuffer());
    let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return { tipo: b.type, b64: btoa(s) };
  });
  fs.writeFileSync(path.join(outDir, 'fieldo-divulgacao.mp4'), Buffer.from(arq.b64, 'base64'));
  console.log('vídeo:', arq.tipo, Math.round(Buffer.from(arq.b64, 'base64').length / 1024) + ' KB');
  await shot('5-pronto');
  console.log('erros JS:', erros.length ? erros : 'nenhum');
  await browser.close();
})().catch((e) => { console.error('FALHOU', e.message); process.exit(1); });
