/* ============================================================
   Fieldo Locação · contratos-ui-detalhe.js  v1.0
   Contrato já enviado: status, documento + integridade, link
   (WhatsApp / copiar / novo / cancelar), assinatura da locadora,
   PDF final, nova versão, cancelamento e histórico.
   Carrega depois de contratos-ui-rascunho.js.
============================================================ */
(function () {
  'use strict';
  var UI = LocContratosUI;
  function x() { return UI._ctx(); }
  function el(id) { return document.getElementById(id); }

  var EVENTO = {
    criado: 'Rascunho criado', rascunho_salvo: 'Rascunho salvo', enviado: 'Enviado para assinatura',
    link_gerado: 'Novo link gerado', link_revogado: 'Link cancelado', visualizado: 'Cliente abriu o contrato',
    tentativa_invalida: 'Tentativa de assinatura com dados que não conferem', assinado_locatario: 'Cliente assinou',
    assinado_locadora: 'Locadora assinou', concluido: 'Contrato concluído', recusado: 'Cliente recusou',
    cancelado: 'Cancelado', substituido: 'Substituído por nova versão', nova_versao: 'Nova versão criada',
    pdf_arquivado: 'PDF final arquivado'
  };

  var atual = null, pad = null;

  function baixar(blob, nome) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function nomePdf(c) { return 'contrato-' + c.numero + '-v' + c.versao + '.pdf'; }

  UI._detalhe = function (c, eventos) {
    var k = x(), d = c.dados || {}, ass = c.loc_contrato_assinaturas || [];
    atual = c; pad = null;
    var assLoc = ass.filter(function (a) { return a.parte === 'locadora'; })[0];
    var assCli = ass.filter(function (a) { return a.parte === 'locatario'; })[0];
    var pendente = c.status === 'aguardando_cliente' || c.status === 'aguardando_locadora';
    var token = pendente ? k.C.Tokens.ler(c.id) : null;
    var linkValido = pendente && !c.revogado_em && (!c.token_expira_em || new Date(c.token_expira_em) > new Date());

    /* v12.19 · linha do tempo + "próximo passo" em palavras simples:
       antes o topo dizia só "Aguardando assinatura da locadora", e a
       locadora não percebia que a vez era dela. */
    var etapas = [
      { t: 'Rascunho', ok: true },
      { t: 'Link enviado', ok: !!c.enviado_em },
      { t: 'Cliente assinou', ok: !!assCli },
      { t: 'Você assinou', ok: !!assLoc },
      { t: 'Concluído', ok: c.status === 'assinado' }
    ];
    var encerrado = ['recusado', 'cancelado', 'substituido'].indexOf(c.status) >= 0;
    var agora = encerrado ? -1 : etapas.map(function (e) { return e.ok; }).indexOf(false);
    var prox;
    if (c.status === 'aguardando_cliente') prox = assLoc
      ? 'Você já assinou. Agora é a vez do cliente: envie o link pelo WhatsApp (abaixo) e aguarde.'
      : 'Envie o link ao cliente pelo WhatsApp (abaixo). Você também já pode assinar, mais abaixo.';
    else if (c.status === 'aguardando_locadora') prox = 'O cliente já assinou. Falta só a sua assinatura: role até “Sua assinatura”.';
    else if (c.status === 'assinado') prox = c.pdf_path ? 'Concluído. Baixe ou envie o PDF ao cliente.' : 'Concluído. Gere o PDF e envie ao cliente.';
    else if (c.status === 'recusado') prox = 'O cliente recusou este contrato. Converse com ele e, se precisar, crie uma nova versão.';
    else if (c.status === 'cancelado') prox = 'Este contrato foi cancelado e não vale mais.';
    else if (c.status === 'substituido') prox = 'Esta versão foi trocada por uma mais nova e não aceita mais assinaturas.';
    var topo = '<span class="status-pill ' + (UI._COR[c.status] || 'gray') + '">' + k.esc(k.C.STATUS[c.status] || c.status) + '</span>' +
      (encerrado ? '' : '<ol class="ct-linha-tempo">' + etapas.map(function (e, i) {
        return '<li class="' + (e.ok ? 'ok' : (i === agora ? 'agora' : '')) + '">' + k.esc(e.t) + '</li>';
      }).join('') + '</ol>') +
      (prox ? '<div class="ct-proximo"><b>Próximo passo</b>' + k.esc(prox) + '</div>' : '');

    var html = '<div class="ct-box">' + topo +
      '<div class="ct-meta">Cliente: ' + k.esc((d.cliente || {}).nome || '—') + ' · enviado em ' + k.esc(k.Doc.fmtDataHora(c.enviado_em)) +
      (pendente && c.token_expira_em ? '<br>Link válido até ' + k.esc(k.Doc.fmtDataHora(c.token_expira_em)) : '') +
      (c.revogado_em && pendente ? '<br><strong>Link cancelado.</strong>' : '') + '</div></div>';

    /* quando é a vez da locadora, a assinatura vem primeiro */
    var blocoAssinar = '';
    if (pendente && !assLoc) {
      blocoAssinar = '<div class="ct-box" id="ctBoxAssinar"><h3>Sua assinatura</h3>' +
        '<p class="ct-meta" style="margin-top:0">Leia o documento mais abaixo antes de assinar. Você pode assinar antes ou depois do cliente.</p>' +
        '<label style="display:flex;gap:.55rem;align-items:flex-start;font-size:.88rem;line-height:1.5;margin-bottom:.8rem">' +
        '<input type="checkbox" id="ctAceiteLoc" style="margin-top:.25rem;width:18px;height:18px;flex:none"/><span>' + k.esc(k.Doc.ACEITE_LOCADORA) + '</span></label>' +
        '<div class="field-label">Desenhe sua assinatura <span class="opc">(opcional)</span></div><canvas class="ct-canvas" id="ctPadLoc" aria-label="Área para desenhar a assinatura"></canvas>' +
        '<div class="ct-acts"><button type="button" class="btn btn--ghost btn--sm" data-ct="dt_limpar">Limpar desenho</button></div>' +
        '<button type="button" class="btn btn--primary" style="width:100%;margin-top:.6rem" data-ct="dt_assinar" id="ctBtnAssinarLoc">Assinar como locadora</button></div>';
    }
    if (c.status === 'aguardando_locadora') { html += blocoAssinar; blocoAssinar = ''; }

    /* link para o cliente */
    if (pendente && !assCli) {
      html += '<div class="ct-box"><h3>Link de assinatura do cliente</h3>';
      if (token && linkValido) {
        var link = k.C.linkAssinatura(token);
        html += (k.st.recemEnviado === c.id ? '<div class="ct-ok">Link gerado. Envie ao cliente pelo WhatsApp.</div>' : '') +
          '<button type="button" class="btn btn--wa" style="width:100%" data-ct="dt_whats">Enviar o link pelo WhatsApp</button>' +
          '<div class="field-group" style="margin-top:.8rem"><label class="field-label" for="ctLink">Link (se o WhatsApp não abrir)</label>' +
          '<input class="field-input" id="ctLink" readonly value="' + k.esc(link) + '"/></div>' +
          '<div class="ct-acts"><button type="button" class="btn btn--ghost btn--sm" data-ct="dt_copiar">Copiar link</button>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-ct="dt_novolink">Gerar novo link</button>' +
          '<button type="button" class="btn btn--ghost btn--sm" style="color:var(--red)" data-ct="dt_revogar">Cancelar link</button></div>';
      } else {
        html += '<p class="ct-meta" style="margin-top:0">' + (linkValido
          ? 'O link foi gerado em outro aparelho. Para enviar daqui, gere um novo link — o anterior deixa de funcionar.'
          : 'O link atual não está ativo (cancelado ou expirado).') + '</p>' +
          '<button type="button" class="btn btn--primary" style="width:100%" data-ct="dt_novolink">Gerar novo link</button>';
      }
      html += '</div>';
    }
    k.st.recemEnviado = null;

    html += blocoAssinar;

    /* PDF final */
    if (c.status === 'assinado') {
      html += '<div class="ct-box"><h3>PDF final</h3>' + (c.pdf_path
        ? '<div class="ct-acts"><button type="button" class="btn btn--primary btn--sm" style="flex:1" data-ct="dt_pdf_baixar">Baixar PDF</button>' +
          '<button type="button" class="btn btn--ghost btn--sm" style="flex:1" data-ct="dt_pdf_compartilhar">Compartilhar</button></div>'
        : '<p class="ct-meta" style="margin-top:0">Gera o PDF com o contrato e o termo de assinaturas e evidências, e guarda uma cópia protegida.</p>' +
          '<button type="button" class="btn btn--primary" style="width:100%" data-ct="dt_pdf_gerar" id="ctBtnPdf">Gerar e arquivar PDF</button>') + '</div>';
    }

    /* documento */
    html += '<div class="ct-box"><h3>Documento · ' + k.esc(c.numero) + ' v' + k.esc(c.versao) + '</h3>' +
      '<div id="ctInteg" class="ct-meta" style="margin-top:0">Conferindo integridade…</div>' +
      '<div class="ct-doc">' + k.Doc.toHtml(c.documento_texto) + '</div>' +
      '<div class="ct-meta">SHA-256: <span style="word-break:break-all">' + k.esc(c.documento_hash) + '</span></div></div>';

    /* assinaturas registradas */
    if (ass.length) {
      html += '<div class="ct-box"><h3>Assinaturas registradas</h3>' + ass.map(function (a) {
        return '<div class="ct-hist"><strong>' + (a.parte === 'locadora' ? 'Locadora' : 'Cliente') + '</strong> — ' + k.esc(a.nome) +
          ' · ' + k.esc(k.Doc.fmtDataHora(a.assinado_em)) + (a.ip ? ' · IP ' + k.esc(a.ip) : '') + '</div>';
      }).join('') + '</div>';
    }

    /* outras ações */
    var acts = '';
    if (['aguardando_cliente', 'aguardando_locadora', 'assinado', 'recusado', 'cancelado'].indexOf(c.status) >= 0)
      acts += '<button type="button" class="btn btn--ghost btn--sm" data-ct="dt_novaversao">Criar nova versão</button>';
    if (pendente) acts += '<button type="button" class="btn btn--ghost btn--sm" style="color:var(--red)" data-ct="dt_cancelar">Cancelar contrato</button>';
    if (acts) html += '<div class="ct-box"><h3>Alterações</h3><p class="ct-meta" style="margin-top:0">Um contrato enviado não é editado. ' +
      'Para mudar algo, crie uma nova versão: a atual continua no histórico.</p><div class="ct-acts">' + acts + '</div></div>';

    html += '<div class="ct-box"><h3>Histórico</h3>' + ((eventos || []).map(function (e) {
      return '<div class="ct-hist">' + k.esc(k.Doc.fmtDataHora(e.created_at)) + ' — ' + k.esc(EVENTO[e.tipo] || e.tipo) +
        (e.detalhe && e.detalhe.motivo ? ' (' + k.esc(e.detalhe.motivo) + ')' : '') + '</div>';
    }).join('') || '<div class="ct-hist">Sem eventos.</div>') + '</div>';

    UI._sheet('Contrato ' + c.numero, html);

    if (el('ctPadLoc')) pad = AssinaturaPad(el('ctPadLoc'));
    k.Doc.sha256(c.documento_texto).then(function (h) {
      var ok = h === c.documento_hash;
      el('ctInteg').innerHTML = ok ? '<span style="color:var(--green)">Integridade conferida: o texto corresponde ao código registrado.</span>'
        : '<span style="color:var(--red)">Atenção: o texto não corresponde ao código registrado.</span>';
    }).catch(function () { if (el('ctInteg')) el('ctInteg').textContent = 'Não foi possível conferir a integridade neste navegador.'; });
  };

  function reabrir() { return x().recarregar().then(function () { return UI._abrir(atual.id); }); }

  /* ── ações ─────────────────────────────────────────────────── */
  var A = UI._acoes;

  A.dt_whats = function () {
    var k = x(), t = k.C.Tokens.ler(atual.id);
    if (!t) return k.toast('Gere um novo link.');
    var msg = k.C.mensagemWhatsApp(k.C.linkAssinatura(t));
    var fone = (atual.dados && atual.dados.cliente && atual.dados.cliente.telefone) || '';
    var url = FIELDO.UI.waLink(fone, msg) || FIELDO.UI.waPicker(msg);
    window.open(url, '_blank', 'noopener');
  };

  A.dt_copiar = function () {
    var k = x(), inp = el('ctLink');
    if (!inp) return;
    var ok = function () { k.toast('Link copiado.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inp.value).then(ok, function () { inp.select(); k.toast('Selecione e copie o link.'); });
    } else { inp.select(); try { document.execCommand('copy'); ok(); } catch (e) { k.toast('Selecione e copie o link.'); } }
  };

  A.dt_novolink = function () {
    var k = x();
    UI._confirma('Gerar um novo link?', 'O link anterior deixa de funcionar. Mande o novo ao cliente.', 'Gerar novo link').then(function (ok) {
      if (!ok) return;
      k.C.novoLink(atual.id, 7).then(function () { k.st.recemEnviado = atual.id; return reabrir(); })
        .catch(function (err) { k.toast(err.message); });
    });
  };

  A.dt_revogar = function () {
    var k = x();
    UI._confirma('Cancelar o link?', 'O cliente não conseguirá mais abrir nem assinar por ele.', 'Cancelar link', true).then(function (ok) {
      if (!ok) return;
      k.C.revogarLink(atual.id).then(function () { k.toast('Link cancelado.'); return reabrir(); })
        .catch(function (err) { k.toast(err.message); });
    });
  };

  A.dt_limpar = function () { if (pad) pad.limpar(); };

  A.dt_assinar = function () {
    var k = x(), btn = el('ctBtnAssinarLoc');
    if (!el('ctAceiteLoc').checked) return k.toast('Marque a confirmação de leitura e aceite.');
    btn.disabled = true; btn.textContent = 'Registrando…';
    k.C.assinarLocadora(atual.id, k.Doc.ACEITE_VERSAO, k.Doc.ACEITE_LOCADORA, pad ? pad.png() : null)
      .then(function (r) {
        k.toast(r.status === 'assinado' ? 'Contrato concluído.' : 'Assinatura registrada. Falta o cliente.');
        return reabrir();
      })
      .catch(function (err) { btn.disabled = false; btn.textContent = 'Assinar como locadora'; k.toast(err.message); });
  };

  A.dt_pdf_gerar = function () {
    var k = x(), btn = el('ctBtnPdf'), blob;
    btn.disabled = true; btn.textContent = 'Gerando PDF…';
    FieldoContratoPdf.gerar(atual, atual.loc_contrato_assinaturas || [])
      .then(function (b) { blob = b; return FieldoContratoPdf.sha256Blob(b); })
      .then(function (h) { return k.C.arquivarPdf(atual, blob, h); })
      .then(function () { baixar(blob, nomePdf(atual)); k.toast('PDF gerado e arquivado.'); return reabrir(); })
      .catch(function (err) {
        btn.disabled = false; btn.textContent = 'Gerar e arquivar PDF';
        console.error('[contratos] pdf', err);
        k.toast(err.message || 'Falha ao gerar o PDF.');
      });
  };

  function pdfArquivado() {
    var k = x(), blob;
    return k.C.baixarPdfArquivado(atual.pdf_path)
      .then(function (b) { blob = b; return FieldoContratoPdf.sha256Blob(b); })
      .then(function (h) {
        if (atual.pdf_hash && h !== atual.pdf_hash) throw new Error('O arquivo baixado não confere com o registrado.');
        return blob;
      });
  }

  A.dt_pdf_baixar = function () {
    var k = x();
    pdfArquivado().then(function (b) { baixar(b, nomePdf(atual)); })
      .catch(function (err) { k.toast(err.message); });
  };

  A.dt_pdf_compartilhar = function () {
    var k = x();
    pdfArquivado().then(function (b) {
      var f = null;
      try { f = new File([b], nomePdf(atual), { type: 'application/pdf' }); } catch (e) { f = null; }
      if (f && navigator.canShare && navigator.canShare({ files: [f] })) {
        return navigator.share({ files: [f], title: 'Contrato ' + atual.numero });
      }
      baixar(b, nomePdf(atual));
      k.toast('PDF baixado. Anexe no WhatsApp pelo clipe de arquivos.');
    }).catch(function (err) { if (err && err.name !== 'AbortError') k.toast(err.message); });
  };

  A.dt_novaversao = function () {
    var k = x();
    UI._confirma('Criar uma nova versão?', 'Você corrige o que precisar e envia de novo. A versão atual continua valendo até a nova ser enviada (ou assinada, se esta já estiver assinada) e fica guardada no histórico.', 'Criar nova versão').then(function (ok) {
      if (!ok) return;
    k.C.novaVersao(atual.id)
      .then(function (r) { return k.recarregar().then(function () { return UI._abrir(r.contrato_id); }); })
      .catch(function (err) {
        if (err.code === 'ja_existe_rascunho' && err.detalhe && err.detalhe.contrato_id) return UI._abrir(err.detalhe.contrato_id);
        k.toast(err.message);
      });
    });
  };

  A.dt_cancelar = function () {
    var k = x();
    var pedir = (typeof LP !== 'undefined' && LP.confirmar)
      ? LP.confirmar({ titulo: 'Cancelar este contrato?', texto: 'O link deixa de funcionar e o contrato não vale mais. Fica guardado no histórico.',
          html: '<div class="fg"><label class="field-label" for="ctMotivo">Motivo <span class="opc">(opcional)</span></label><input class="field-input" id="ctMotivo" maxlength="300"/></div>',
          ok: 'Cancelar contrato', cancelar: 'Voltar', perigo: true }).then(function (box) { return box ? (box.querySelector('#ctMotivo').value || '') : null; })
      : Promise.resolve(prompt('Motivo do cancelamento (opcional):', ''));
    pedir.then(function (motivo) {
      if (motivo === null) return;
      k.C.cancelar(atual.id, motivo).then(function () { k.toast('Contrato cancelado.'); return reabrir(); })
        .catch(function (err) { k.toast(err.message); });
    });
  };
})();
