/* ============================================================
   Fieldo Locação · contrato-pdf.js  v1.0
   ─────────────────────────────────────────────────────────────
   Gera o PDF final do contrato a partir do TEXTO CONGELADO e das
   assinaturas registradas no banco — nada é recomposto a partir de
   dados vivos, então o PDF corresponde à versão que foi aceita.

   Páginas: (1) contrato completo; (2) termo de assinaturas e
   evidências (identificador, hash SHA-256, datas, IP, dispositivo,
   texto do aceite, desenho da assinatura).

   Determinístico: data de criação e ID do arquivo vêm do próprio
   contrato, então o mesmo contrato gera o mesmo PDF.

   jsPDF 4.2.1 (arquivo local jspdf.umd.min.js, carregado só quando
   o PDF é pedido). Requer contrato-doc.js carregado antes.
============================================================ */
var FieldoContratoPdf = (function () {
  'use strict';

  var _base = '';
  try { _base = document.currentScript.src.replace(/[^\/]*$/, ''); } catch (e) { _base = ''; }
  var _carregando = null;

  function carregarJsPdf() {
    var g = (typeof window !== 'undefined') ? window : globalThis;
    if (g.jspdf && g.jspdf.jsPDF) return Promise.resolve(g.jspdf.jsPDF);
    if (_carregando) return _carregando;
    _carregando = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = _base + 'jspdf.umd.min.js';
      s.async = true;
      s.onload = function () {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else { _carregando = null; reject(new Error('jspdf_ausente')); }
      };
      s.onerror = function () { _carregando = null; reject(new Error('jspdf_falhou')); };
      document.head.appendChild(s);
    });
    return _carregando;
  }

  /* Fontes padrão do PDF cobrem Latin-1 + alguns símbolos do Windows-1252.
     O resto vira ASCII aproximado, para nunca sair lixo no documento. */
  var CP1252 = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  function seguro(s) {
    s = String(s == null ? '' : s);
    try { s = s.normalize('NFC'); } catch (e) { /* ok */ }
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], c = s.charCodeAt(i);
      if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || CP1252.indexOf(ch) >= 0 || ch === '\n') { out += ch; continue; }
      if (ch === '→') { out += '->'; continue; }
      if (ch === '✓' || ch === '✔') { out += ''; continue; }
      var base = ch.normalize ? ch.normalize('NFD').replace(/[̀-ͯ]/g, '') : ch;
      out += (base.length === 1 && base.charCodeAt(0) < 127) ? base : '?';
    }
    return out;
  }

  /* gerar(contrato, assinaturas, opts) → Promise<Blob>
     contrato: { numero, versao, documento_texto, documento_hash, enviado_em, concluido_em }
     assinaturas: [{ parte, nome, documento, assinado_em, documento_hash, aceite_versao,
                     aceite_texto, ip, user_agent, traco_png }]
     opts: { jsPDF } (opcional, para testes) */
  function gerar(contrato, assinaturas, opts) {
    opts = opts || {};
    var Doc = FieldoContratoDoc;
    var pronto = opts.jsPDF ? Promise.resolve(opts.jsPDF) : carregarJsPdf();
    return pronto.then(function (JsPDF) {
      var doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      var W = 210, H = 297, M = 20, LARG = W - 2 * M, RODAPE = 14, y = M;

      doc.setProperties({
        /* v12.40 · opts.titulo/assunto/autor: o contrato de obra usa o mesmo gerador */
        title: seguro((opts.titulo || 'Contrato de locação') + ' ' + contrato.numero + ' v' + contrato.versao),
        subject: opts.assunto || 'Contrato de locação de equipamentos',
        author: opts.autor || 'Fieldo Locação', creator: opts.autor || 'Fieldo Locação',
      });
      try { doc.setCreationDate(new Date(contrato.concluido_em || contrato.enviado_em || 0)); } catch (e) { /* ok */ }
      try { doc.setFileId(String(contrato.documento_hash || '').slice(0, 32).toUpperCase()); } catch (e) { /* ok */ }

      function livre() { return H - M - RODAPE - y; }
      function nova() { doc.addPage(); y = M; }
      function precisa(mm) { if (livre() < mm) nova(); }

      function texto(s, tam, estilo, recuo, entre) {
        doc.setFont('helvetica', estilo || 'normal');
        doc.setFontSize(tam);
        var passo = tam * 0.43;
        var linhas = doc.splitTextToSize(seguro(s), LARG - (recuo || 0));
        for (var i = 0; i < linhas.length; i++) {
          precisa(passo);
          doc.text(linhas[i], M + (recuo || 0), y + tam * 0.3);
          y += passo;
        }
        y += (entre == null ? 1.6 : entre);
      }

      /* ── 1. contrato ── */
      Doc.blocos(contrato.documento_texto).forEach(function (b) {
        if (b.t === 'h1') {
          precisa(14); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
          doc.text(seguro(b.x), W / 2, y + 5, { align: 'center' }); y += 11;
        } else if (b.t === 'h2') {
          precisa(14); y += 3; texto(b.x, 11.5, 'bold', 0, 0.6);
          doc.setDrawColor(150); doc.setLineWidth(0.2); doc.line(M, y, W - M, y); y += 2.2;
        } else if (b.t === 'h3') {
          precisa(12); y += 1; texto(b.x, 10, 'bold', 0, 0.8);
        } else if (b.t === 'li') {
          precisa(6); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
          doc.text('•', M + 2, y + 3);
          texto(b.x, 10, 'normal', 6, 1.2);
        } else {
          texto(b.x, 10, 'normal', 0, 2);
        }
      });

      /* ── 2. termo de assinaturas e evidências ── */
      nova();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
      doc.text('TERMO DE ASSINATURAS E EVIDÊNCIAS', W / 2, y + 5, { align: 'center' }); y += 12;

      texto('Contrato: ' + contrato.numero + ' · versão ' + contrato.versao, 10, 'bold', 0, 1);
      texto('Código de integridade (SHA-256 do texto do contrato):', 9, 'normal', 0, 0.4);
      doc.setFont('courier', 'normal'); doc.setFontSize(8.6);
      var h = String(contrato.documento_hash || '');
      doc.text(h.slice(0, 32), M, y + 3); y += 4.2;
      doc.text(h.slice(32), M, y + 3); y += 6;
      if (contrato.enviado_em)   texto('Enviado para assinatura em: ' + Doc.fmtDataHora(contrato.enviado_em), 9, 'normal', 0, 0.6);
      if (contrato.concluido_em) texto('Concluído em: ' + Doc.fmtDataHora(contrato.concluido_em) + ' (horário de Brasília)', 9, 'normal', 0, 3);

      var rotulo = opts.rotulos || { locadora: 'LOCADORA', locatario: 'LOCATÁRIO(A)' };
      (assinaturas || []).slice().sort(function (a, b) {
        return String(a.assinado_em).localeCompare(String(b.assinado_em));
      }).forEach(function (a) {
        var temImg = !!a.traco_png;
        precisa(temImg ? 78 : 56);
        doc.setDrawColor(190); doc.setLineWidth(0.2); doc.line(M, y, W - M, y); y += 3;
        texto((rotulo[a.parte] || a.parte) + ' — ' + a.nome, 10.5, 'bold', 0, 0.8);
        texto('CPF/CNPJ: ' + Doc.fmtDoc(a.documento), 9, 'normal', 0, 0.4);
        texto('Aceite eletrônico em: ' + Doc.fmtDataHora(a.assinado_em), 9, 'normal', 0, 0.4);
        texto('Método: assinatura eletrônica simples (aceite eletrônico com registro de evidências)', 9, 'normal', 0, 0.4);
        if (a.ip)         texto('Endereço IP: ' + a.ip, 9, 'normal', 0, 0.4);
        if (a.user_agent) texto('Dispositivo: ' + String(a.user_agent).slice(0, 160), 8.2, 'normal', 0, 0.4);
        texto('Texto aceito (' + (a.aceite_versao || '') + '): ' + (a.aceite_texto || ''), 8.2, 'normal', 0, 0.4);
        if (a.documento_hash) texto('Hash do documento no momento do aceite: ' + a.documento_hash, 7.4, 'normal', 0, 1);
        if (temImg) {
          try {
            var p = doc.getImageProperties(a.traco_png);
            var w = 62, hh = Math.min(26, w * (p.height / p.width));
            doc.setDrawColor(210); doc.rect(M, y, w + 2, hh + 2);
            doc.addImage(a.traco_png, 'PNG', M + 1, y + 1, w, hh);
            y += hh + 5;
          } catch (e) {
            texto('[desenho da assinatura indisponível]', 8.2, 'italic', 0, 2);
          }
        }
        y += 2;
      });

      precisa(40);
      doc.setDrawColor(190); doc.line(M, y, W - M, y); y += 3;
      texto('Como conferir a integridade', 9.5, 'bold', 0, 0.8);
      texto('Calcule o SHA-256 do texto do contrato e compare com o código de integridade acima; o código também é exibido ' +
            'na página de assinatura. Se o texto for alterado, o código deixa de coincidir.', 8.6, 'normal', 0, 2);
      texto('Limites deste registro', 9.5, 'bold', 0, 0.8);
      texto('A assinatura aqui registrada é eletrônica simples: baseia-se no aceite das partes e nas evidências acima, sem ' +
            'certificado digital ICP-Brasil. A força probatória depende das circunstâncias do caso e pode ser avaliada em juízo.',
            8.6, 'normal', 0, 0);

      /* rodapé em todas as páginas */
      var total = doc.getNumberOfPages();
      for (var pg = 1; pg <= total; pg++) {
        doc.setPage(pg);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); doc.setTextColor(110);
        doc.text(seguro('Contrato ' + contrato.numero + ' · v' + contrato.versao + ' · SHA-256 ' +
                 String(contrato.documento_hash || '').slice(0, 16) + '…'), M, H - 9);
        doc.text('Página ' + pg + ' de ' + total, W - M, H - 9, { align: 'right' });
        doc.setTextColor(0);
      }

      return doc.output('blob');
    });
  }

  function sha256Blob(blob) {
    return blob.arrayBuffer().then(function (buf) { return crypto.subtle.digest('SHA-256', buf); })
      .then(function (d) {
        var b = new Uint8Array(d), s = '';
        for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
        return s;
      });
  }

  var api = { gerar: gerar, sha256Blob: sha256Blob, carregarJsPdf: carregarJsPdf, _seguro: seguro };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
