/* ============================================================
   Fieldo Locação · painel-perfil.js  v12.19
   Meu perfil, em três blocos que não se misturam:
   1. Sua vitrine — o que o cliente vê (nome, WhatsApp, cidade, foto,
      descrição, Instagram, entrega). Antes da v12.19 nada disto podia
      ser editado depois de criar a vitrine.
   2. Dados para contratos — razão social, CPF/CNPJ, endereço, e-mail e
      condições padrão. Preenchidos uma vez; todo contrato novo nasce
      com eles (o banco já os lia de locadoras; faltava a tela).
   3. Acesso à conta — código de recuperação, e-mail e senha, Sair.
============================================================ */
(function () {
  'use strict';
  var esc = LP.esc, q = LP.q;

  function v(id) { var el = q(id); return el ? (el.value || '').trim() : ''; }
  function campo(id, rotulo, valor, o) {
    o = o || {};
    var attrs = ' id="' + id + '"' + (o.tipo ? ' type="' + o.tipo + '"' : ' type="text"') +
      (o.inputmode ? ' inputmode="' + o.inputmode + '"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') +
      (o.auto ? ' autocomplete="' + o.auto + '"' : '') + (o.max ? ' maxlength="' + o.max + '"' : '');
    var input = o.area
      ? '<textarea class="field-textarea"' + attrs.replace(/ type="[^"]*"/, '') + ' rows="' + (o.linhas || 3) + '">' + esc(valor || '') + '</textarea>'
      : '<input class="field-input"' + attrs + ' value="' + esc(valor == null ? '' : valor) + '"/>';
    return '<div class="fg" id="fg_' + id + '"><label class="field-label" for="' + id + '">' + esc(rotulo) +
      (o.opc ? ' <span class="opc">(opcional)</span>' : '') + '</label>' + input +
      (o.dica ? '<div class="field-hint">' + o.dica + '</div>' : '') + '<div class="fg-erro" hidden></div></div>';
  }
  LP.campo = campo;
  LP.marcarErro = function (id, msg) {
    var fg = q('fg_' + id); if (!fg) return;
    fg.classList.toggle('erro', !!msg);
    var e = fg.querySelector('.fg-erro'); if (e) { e.hidden = !msg; e.textContent = msg || ''; }
    if (msg) { var i = q(id); if (i) { i.focus(); i.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
  };
  function limparErros(ids) { ids.forEach(function (id) { LP.marcarErro(id, ''); }); }

  LP.vitrineUrl = function () {
    var s = LP.st.locadora && LP.st.locadora.slug;
    return s ? FIELDO.publicUrl('l/' + encodeURIComponent(s)) : '';
  };
  LP.linkWhatsVitrine = function () {
    var url = LP.vitrineUrl(), l = LP.st.locadora || {};
    return FIELDO.UI.waPicker('Equipamentos para alugar · ' + (l.nome || '') + ': ' + url);
  };

  function avatarHTML(l) {
    return l.logo_url ? '<img src="' + esc(l.logo_url) + '" alt=""/>' : esc(((l.nome || '?').trim().charAt(0) || '?').toUpperCase());
  }

  LP.abas.perfil = function (el) {
    var l = LP.st.locadora || {}, eq = LP.st.equip || [];
    var naVitrine = eq.filter(function (e) { return e.is_public && e.ativo !== false; }).length;
    var url = LP.vitrineUrl(), on = !!l.is_public && !!url;
    var temResp = Object.prototype.hasOwnProperty.call(l, 'responsavel');
    var Doc = typeof FieldoContratoDoc !== 'undefined' ? FieldoContratoDoc : null;
    var cond = (LP.st.modelo && LP.st.modelo.condicoes) || {};

    var html =
      '<div class="lp-cab"><div><h1>Meu perfil</h1><p>Mantenha os dados da sua locadora atualizados. O que muda aqui aparece na vitrine e nos próximos contratos.</p></div></div>' +
      LP.dicaHTML('perfil', 'Este perfil tem duas partes: <strong>Sua vitrine</strong> (o que o cliente vê) e <strong>Dados para contratos</strong> (só aparecem no contrato).') +

      /* 1. vitrine */
      '<div class="lp-card" id="pfVitrine"><h2>Sua vitrine</h2><p class="sub">É a página pública da sua locadora, com seus equipamentos e um botão de WhatsApp.</p>' +
        (on
          ? '<div class="pf-estado on"><div><b>Sua vitrine está no ar</b><span>' + esc(LP.plural(naVitrine, 'equipamento aparece', 'equipamentos aparecem')) + ' para os clientes.</span></div></div>' +
            '<div class="vt-url">' + esc(url.replace(/^https?:\/\//, '')) + '</div>' +
            '<div class="vt-acoes"><a class="btn btn--ghost btn--sm" href="' + esc(url) + '" target="_blank" rel="noopener">Ver vitrine</a>' +
            '<button type="button" class="btn btn--ghost btn--sm" data-pf="copiar">Copiar link</button>' +
            '<a class="btn btn--wa-sec btn--sm" href="' + esc(LP.linkWhatsVitrine()) + '" target="_blank" rel="noopener">' + LP.ICONE_WA + 'Enviar no WhatsApp</a></div>' +
            '<p style="margin:.7rem 0 0"><button type="button" class="link-acao" data-pf="tirar-ar" style="color:var(--muted)">Tirar a vitrine do ar</button></p>'
          : '<div class="pf-estado off"><div><b>Sua vitrine ainda não está no ar</b><span>' +
              (eq.length ? 'Ela entra no ar quando pelo menos um equipamento estiver com “Na vitrine” ligado.' : 'Cadastre um equipamento e deixe “Na vitrine” ligado. A página entra no ar na hora.') +
            '</span></div></div>' +
            '<button type="button" class="btn btn--primary btn--sm" ' + (eq.length ? 'data-ir="equipamentos"' : 'data-acao="novo-equip"') + '>' + (eq.length ? 'Ligar “Na vitrine” nos equipamentos' : 'Cadastrar equipamento') + '</button>') +

        '<div style="border-top:1px solid var(--border);margin:1.1rem 0 1rem"></div>' +
        '<div class="pf-id"><button type="button" class="pf-avatar" id="pfAvatar" data-pf="foto" aria-label="' + (l.logo_url ? 'Trocar foto' : 'Adicionar foto') + '">' + avatarHTML(l) + '</button>' +
          '<div><div style="font-weight:600;color:var(--ink)">Foto ou logotipo</div><div style="font-size:.82rem;color:var(--muted);line-height:1.45">Aparece no topo da vitrine e na prévia do link no WhatsApp.</div>' +
          '<button type="button" class="link-acao" data-pf="foto">' + (l.logo_url ? 'Trocar foto' : 'Adicionar foto') + '</button>' +
          (l.logo_url ? ' &nbsp; <button type="button" class="link-acao" style="color:var(--muted)" data-pf="foto-remover">Remover</button>' : '') + '</div></div>' +
        campo('pfNome', 'Nome da locadora', l.nome, { ph: 'Ex.: Silva Locações', auto: 'organization', max: 120 }) +
        (temResp ? campo('pfResp', 'Nome do responsável', l.responsavel, { ph: 'Ex.: João da Silva', auto: 'name', max: 120, opc: 1,
          dica: 'Quem assina os contratos pela locadora. Não aparece na vitrine.' }) : '') +
        campo('pfWhats', 'WhatsApp', l.whatsapp, { tipo: 'tel', inputmode: 'tel', ph: '(12) 99999-9999', auto: 'tel', dica: 'O botão de contato da vitrine abre conversa com este número.' }) +
        campo('pfCidade', 'Cidade', l.city, { ph: 'Ex.: Caraguatatuba – SP', auto: 'address-level2', dica: 'Escreva a cidade e o estado. É por ela que o cliente encontra você.' }) +
        campo('pfBio', 'Descrição da empresa', l.bio, { area: 1, linhas: 3, max: 600, opc: 1, ph: 'Ex.: Aluguel de betoneiras, andaimes e geradores desde 2015. Entregamos em toda a região.',
          dica: 'Uma ou duas frases. Aparece abaixo do nome na vitrine.' }) +
        campo('pfInsta', 'Instagram', l.instagram, { ph: '@sualocadora', opc: 1, max: 60 }) +
        '<label class="lp-check"><input type="checkbox" id="pfEntrega"' + (l.entrega ? ' checked' : '') + '/><span><strong>Faço entrega</strong> — a vitrine mostra “Faz entrega” para o cliente.</span></label>' +
        '<div id="pfRaioBox"' + (l.entrega ? '' : ' hidden') + '>' + campo('pfRaio', 'Entrega até quantos km?', l.raio_entrega_km, { inputmode: 'numeric', ph: 'Ex.: 30', opc: 1 }) + '</div>' +
        '<div class="pf-salvar"><button type="button" class="btn btn--primary" data-pf="salvar-vitrine" id="pfSalvarVitrine">Salvar dados da vitrine</button><span class="pf-salvo" id="pfOkVitrine" hidden>Salvo ✓</span></div>' +
      '</div>' +

      /* 2. contratos */
      '<div class="lp-card" id="pfContrato"><h2>Dados para contratos</h2>' +
        '<p class="sub">Aparecem só nos contratos, nunca na vitrine. Preencha uma vez: todo contrato novo já nasce com estes dados.</p>' +
        campo('pfRazao', 'Razão social ou nome completo', l.razao_social || '', { ph: l.nome ? 'Ex.: ' + l.nome + ' Ltda' : 'Ex.: Silva Locações Ltda', max: 200 }) +
        campo('pfDoc', 'CPF ou CNPJ', l.cnpj || '', { inputmode: 'numeric', ph: 'Só números', max: 20 }) +
        campo('pfEnd', 'Endereço completo', l.endereco || '', { ph: 'Rua, número, bairro, cidade – UF, CEP', max: 300 }) +
        campo('pfEmail', 'E-mail', l.email || '', { tipo: 'email', inputmode: 'email', auto: 'email', opc: 1, max: 120 }) +
        (Doc && LP.st.contratosOk
          ? '<div class="lp-bloco-tit" style="margin-top:.6rem">Condições padrão do aluguel</div>' +
            '<p class="sub">Entram nas cláusulas de todo contrato. Deixe em branco o que não vale para você.</p>' +
            Doc.CAMPOS_CONDICOES.map(function (f) {
              return campo('pfCond_' + f.campo, f.rotulo, cond[f.campo] || '', { ph: f.dica, max: 2000, opc: 1 });
            }).join('')
          : '') +
        '<div class="pf-salvar"><button type="button" class="btn btn--primary" data-pf="salvar-contrato" id="pfSalvarContrato">Salvar dados para contratos</button><span class="pf-salvo" id="pfOkContrato" hidden>Salvo ✓</span></div>' +
      '</div>' +

      /* 3. acesso */
      '<div class="lp-card" id="pfAcesso"><h2>Acesso à conta</h2><p class="sub">Guarde um jeito de entrar antes de trocar de celular ou limpar o navegador.</p>' +
        '<div id="pfEmailBox"><p class="sub" style="margin:0">Conferindo…</p></div>' +
        '<div style="border-top:1px solid var(--border);margin:1rem 0"></div>' +
        blocoCodigo() +
        '<div style="border-top:1px solid var(--border);margin:1rem 0 .4rem"></div>' +
        '<button type="button" class="link-perigo" data-pf="sair">Sair deste aparelho</button>' +
      '</div>';
    el.innerHTML = html;
    var chk = q('pfEntrega');
    if (chk) chk.addEventListener('change', function () { q('pfRaioBox').hidden = !chk.checked; });
    carregarEmail();
  };

  /* ── acesso ─────────────────────────────────────────────────── */
  function codigoGuardado() {
    try { return localStorage.getItem('fieldo_loc_recovery_code') || ''; } catch (e) { return ''; }
  }
  function blocoCodigo() {
    var c = codigoGuardado();
    if (!c) return '<div style="font-weight:600;color:var(--ink);margin-bottom:.2rem">Código de recuperação</div>' +
      '<p class="sub" style="margin:0">Este aparelho não guarda o código (você entrou por e-mail ou limpou o navegador). Se ainda não tem e-mail e senha, crie acima.</p>';
    return '<div style="font-weight:600;color:var(--ink);margin-bottom:.2rem">Código de recuperação</div>' +
      '<p class="sub" style="margin:0 0 .4rem">Os 16 caracteres que abrem sua conta em outro aparelho. Não mostre para ninguém.</p>' +
      '<div class="codigo" id="pfCodigo">••••-••••-••••-••••</div>' +
      '<div class="vt-acoes"><button type="button" class="btn btn--ghost btn--sm" data-pf="cod-mostrar" id="pfCodBtn">Mostrar</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-pf="cod-copiar">Copiar</button></div>';
  }
  function fmtCod(c) { return (String(c).match(/.{1,4}/g) || []).join('-'); }

  function carregarEmail() {
    var box = q('pfEmailBox'); if (!box) return;
    var S = FIELDO.Auth.Session;
    if (!S || !S.emailDeAcesso) { box.innerHTML = ''; return; }
    S.emailDeAcesso().then(function (email) {
      if (!q('pfEmailBox')) return;
      if (email) {
        box.innerHTML = '<div style="font-weight:600;color:var(--ink);margin-bottom:.2rem">E-mail e senha</div>' +
          '<p class="sub" style="margin:0">Você entra com <strong>' + esc(email) + '</strong> e a sua senha, em qualquer aparelho.</p>';
        return;
      }
      box.innerHTML = '<div style="font-weight:600;color:var(--ink);margin-bottom:.2rem">Entrar com e-mail e senha</div>' +
        '<p class="sub">Mais fácil que o código: crie um e-mail e uma senha para entrar em qualquer aparelho.</p>' +
        campo('pfAcEmail', 'E-mail', '', { tipo: 'email', inputmode: 'email', auto: 'email', max: 120 }) +
        campo('pfAcSenha', 'Senha', '', { tipo: 'password', auto: 'new-password', dica: 'Pelo menos 8 caracteres.' }) +
        '<button type="button" class="btn btn--primary btn--sm" data-pf="acesso" id="pfAcBtn">Criar acesso por e-mail</button>';
    }).catch(function () { if (q('pfEmailBox')) q('pfEmailBox').innerHTML = ''; });
  }

  function definirAcesso() {
    var email = v('pfAcEmail').toLowerCase(), senha = q('pfAcSenha') ? q('pfAcSenha').value : '';
    limparErros(['pfAcEmail', 'pfAcSenha']);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return LP.marcarErro('pfAcEmail', 'Confira o e-mail.');
    if (senha.length < 8) return LP.marcarErro('pfAcSenha', 'A senha precisa ter pelo menos 8 caracteres.');
    var b = q('pfAcBtn'); b.disabled = true; b.textContent = 'Salvando…';
    FIELDO.Auth.Session.definirAcesso(email, senha).then(function () {
      LP.toast('Pronto. Agora você entra com ' + email + ' e a sua senha.');
      LP.renderAtual();
    }).catch(function (err) {
      b.disabled = false; b.textContent = 'Criar acesso por e-mail';
      var c = err && err.code;
      if (c === 'email_em_uso') return LP.marcarErro('pfAcEmail', 'Este e-mail já é usado em outra conta do Fieldo.');
      if (c === 'email_invalido') return LP.marcarErro('pfAcEmail', 'Confira o e-mail.');
      if (c === 'senha_curta' || c === 'senha_fraca') return LP.marcarErro('pfAcSenha', 'Escolha uma senha mais forte, com pelo menos 8 caracteres.');
      if (c === 'conta_anonima') return LP.toast('Sua conta ainda não tem código de recuperação. Fale com o suporte.', 5000);
      LP.falhou(err, 'criar o acesso');
    });
  }

  /* ── salvar ─────────────────────────────────────────────────── */
  function salvarVitrine() {
    var nome = v('pfNome'), whats = v('pfWhats'), cidade = v('pfCidade');
    limparErros(['pfNome', 'pfWhats', 'pfCidade', 'pfRaio']);
    if (nome.length < 2) return LP.marcarErro('pfNome', 'Informe o nome da locadora.');
    if (LP.digits(whats).length < 10) return LP.marcarErro('pfWhats', 'Informe o WhatsApp com DDD.');
    if (cidade.length < 3) return LP.marcarErro('pfCidade', 'Informe a cidade.');
    var entrega = q('pfEntrega').checked, raio = entrega ? parseInt(v('pfRaio'), 10) : null;
    if (entrega && v('pfRaio') && (isNaN(raio) || raio < 1 || raio > 500)) return LP.marcarErro('pfRaio', 'Use um número entre 1 e 500.');
    var dados = {
      nome: nome, whatsapp: whats, city: cidade,
      bio: v('pfBio') || null,
      instagram: v('pfInsta').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/+$/, '') || null,
      entrega: entrega, raio_entrega_km: entrega && !isNaN(raio) ? raio : null,
    };
    if (q('pfResp')) dados.responsavel = v('pfResp') || null;
    var b = q('pfSalvarVitrine'); b.disabled = true; b.textContent = 'Salvando…';
    FIELDO_LOCACAO.Locadoras.update(dados).then(function (l) {
      if (l) LP.st.locadora = l;
      LP.toast('Dados da vitrine salvos.');
      LP.renderAtual();
      if (q('pfOkVitrine')) q('pfOkVitrine').hidden = false;
    }).catch(function (err) {
      b.disabled = false; b.textContent = 'Salvar dados da vitrine';
      LP.falhou(err, 'salvar');
    });
  }

  function salvarContrato() {
    var Doc = typeof FieldoContratoDoc !== 'undefined' ? FieldoContratoDoc : null;
    var razao = v('pfRazao'), doc = v('pfDoc'), email = v('pfEmail');
    limparErros(['pfRazao', 'pfDoc', 'pfEnd', 'pfEmail']);
    if (doc && Doc && !Doc.docValido(doc)) return LP.marcarErro('pfDoc', 'Este CPF ou CNPJ não confere. Confira os números.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return LP.marcarErro('pfEmail', 'Confira o e-mail.');
    var dados = { razao_social: razao || null, cnpj: LP.digits(doc) || null, endereco: v('pfEnd') || null, email: email || null };
    var b = q('pfSalvarContrato'); b.disabled = true; b.textContent = 'Salvando…';
    var tarefas = [FIELDO_LOCACAO.Locadoras.update(dados)];
    if (Doc && LP.st.contratosOk && q('pfCond_foro')) {
      var cond = {};
      Doc.CAMPOS_CONDICOES.forEach(function (f) { var x = v('pfCond_' + f.campo); if (x) cond[f.campo] = x; });
      var clausulas = (LP.st.modelo && Array.isArray(LP.st.modelo.clausulas)) ? LP.st.modelo.clausulas : [];
      tarefas.push(FIELDO_LOCACAO.Contratos.modeloSalvar(clausulas, cond).then(function () {
        LP.st.modelo = { clausulas: clausulas, condicoes: cond };
      }));
    }
    Promise.all(tarefas).then(function (r) {
      if (r[0]) LP.st.locadora = r[0];
      LP.toast('Dados para contratos salvos. Os próximos contratos já saem com eles.');
      LP.renderAtual();
      if (q('pfOkContrato')) q('pfOkContrato').hidden = false;
    }).catch(function (err) {
      b.disabled = false; b.textContent = 'Salvar dados para contratos';
      LP.falhou(err, 'salvar');
    });
  }

  function tirarDoAr() {
    var pub = (LP.st.equip || []).filter(function (e) { return e.is_public; });
    LP.confirmar({ titulo: 'Tirar a vitrine do ar?', ok: 'Tirar do ar',
      texto: 'Os ' + pub.length + ' equipamentos deixam de aparecer para os clientes. Nada é apagado: para voltar, ligue “Na vitrine” de novo nos equipamentos.' })
      .then(function (ok) {
        if (!ok) return;
        return Promise.all(pub.map(function (e) { return FIELDO_LOCACAO.Equipamentos.update(e.id, { is_public: false }); }))
          .then(function () { LP.toast('Vitrine fora do ar.'); return LP.recarregar(); })
          .catch(function (err) { LP.falhou(err, 'tirar a vitrine do ar'); LP.recarregar(); });
      });
  }

  /* ── foto ───────────────────────────────────────────────────── */
  var enviando = false;
  q('inpFotoPerfil').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    enviando = true;
    var av = q('pfAvatar'); if (av) av.classList.add('enviando');
    LP.toast('Enviando foto…');
    FIELDO_LOCACAO.Fotos.enviarPerfil(file)
      .then(function (l) { if (l) LP.st.locadora = l; LP.toast('Foto atualizada.'); LP.renderAtual(); })
      .catch(function (err) { LP.toast(err && err.message ? err.message : 'Não foi possível enviar a foto.'); console.error(err); })
      .then(function () { enviando = false; var a = q('pfAvatar'); if (a) a.classList.remove('enviando'); });
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-pf]');
    if (!b) return;
    var a = b.getAttribute('data-pf');
    if (a === 'salvar-vitrine') salvarVitrine();
    else if (a === 'salvar-contrato') salvarContrato();
    else if (a === 'acesso') definirAcesso();
    else if (a === 'tirar-ar') tirarDoAr();
    else if (a === 'foto') { if (!enviando) q('inpFotoPerfil').click(); }
    else if (a === 'foto-remover') {
      LP.confirmar({ titulo: 'Remover a foto?', texto: 'A vitrine passa a mostrar a inicial do nome.', ok: 'Remover', perigo: true }).then(function (ok) {
        if (!ok) return;
        var antiga = LP.st.locadora && LP.st.locadora.logo_url;
        FIELDO_LOCACAO.Fotos.removerPerfil().then(function (l) {
          if (l) LP.st.locadora = l; FIELDO_LOCACAO.Fotos.apagar(antiga); LP.toast('Foto removida.'); LP.renderAtual();
        }).catch(function (err) { LP.falhou(err, 'remover a foto'); });
      });
    }
    else if (a === 'copiar') {
      var url = LP.vitrineUrl();
      var ok = function () { LP.toast('Link copiado.'); }, nao = function () { LP.toast('Toque e segure no endereço para copiar.'); };
      try { navigator.clipboard.writeText(url).then(ok, nao); } catch (er) { nao(); }
    }
    else if (a === 'cod-mostrar') {
      var c = q('pfCodigo'), mostrando = b.textContent === 'Esconder';
      c.textContent = mostrando ? '••••-••••-••••-••••' : fmtCod(codigoGuardado());
      b.textContent = mostrando ? 'Mostrar' : 'Esconder';
    }
    else if (a === 'cod-copiar') {
      var cod = fmtCod(codigoGuardado());
      try { navigator.clipboard.writeText(cod).then(function () { LP.toast('Código copiado. Guarde num lugar seguro.'); }, function () { LP.toast('Toque em Mostrar e anote o código.'); }); }
      catch (er) { LP.toast('Toque em Mostrar e anote o código.'); }
    }
    else if (a === 'sair') {
      var temCod = !!codigoGuardado();
      LP.confirmar({ titulo: 'Sair deste aparelho?', ok: 'Sair', perigo: true,
        texto: 'Para entrar de novo você vai precisar do seu e-mail e senha' + (temCod ? ' ou do código de recuperação. Anote o código antes de sair.' : '. Se ainda não criou, crie acima antes de sair.') })
        .then(function (ok) { if (!ok) return; FIELDO.Auth.logout(); location.href = './index.html'; });
    }
  });
})();
