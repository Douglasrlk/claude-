/* ============================================================
   Fieldo Locação · painel-equip.js  v12.19
   Meus equipamentos: lista com "livres hoje", chave Na vitrine no
   próprio cartão e cadastro em tela própria, em três blocos com
   exemplos. Correções da auditoria:
   - a categoria vinha pré-escolhida (a primeira da lista) e quem não
     mexia salvava o gerador como "Betoneira" — agora é obrigatório
     escolher;
   - preço por mês e condições de aluguel: o banco (preco_mes, specs)
     e a vitrine já tinham, faltava onde preencher;
   - excluir um equipamento que já foi alugado falhava com erro do
     banco (o histórico das locações aponta para ele) — agora a tela
     oferece desativar, que tira da vitrine sem apagar o histórico.
============================================================ */
(function () {
  'use strict';
  var esc = LP.esc, q = LP.q;
  var f = { editando: null, fotos: [], novas: [], removidas: [], enviando: 0, inicial: '' };

  function numTxt(n) { return n == null || n === '' ? '' : String(n).replace('.', ','); }
  function v(id) { var el = q(id); return el ? (el.value || '').trim() : ''; }

  function estoque(e) {
    var hoje = LP.D.hojeLocal(), ocup = LP.ocupado(hoje, hoje)[e.id] || 0, total = e.quantidade || 0;
    var livres = Math.max(0, total - ocup), futuras = 0;
    LP.comStatus().forEach(function (x) {
      if (x.vis !== 'reservada' || x.loc.data_saida <= hoje) return;
      (x.loc.locacao_itens || []).forEach(function (it) { if (it.equipamento_id === e.id) futuras += it.quantidade || 0; });
    });
    return { livres: livres, total: total, futuras: futuras };
  }

  LP.abas.equipamentos = function (el) {
    var lista = (LP.st.equip || []).slice().sort(function (a, b) {
      return (a.ativo === false) - (b.ativo === false) || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });
    var html = '<div class="lp-cab"><div><h1>Equipamentos</h1><p>' +
      (lista.length ? esc(LP.plural(lista.length, 'equipamento cadastrado', 'equipamentos cadastrados')) + '.' : 'Cadastre os equipamentos que você deseja alugar.') +
      '</p></div><button type="button" class="btn btn--primary" data-acao="novo-equip">+ Novo equipamento</button></div>' +
      LP.dicaHTML('equipamentos', 'Cadastre os equipamentos que você deseja alugar. Com <strong>“Na vitrine”</strong> ligado, o equipamento aparece na sua página pública com preço e botão de WhatsApp.');
    if (!lista.length) {
      html += '<div class="lp-vazio"><h3>Nenhum equipamento ainda</h3><p>Comece pelo que você mais aluga. Uma foto e o preço da diária já bastam.</p>' +
        '<button type="button" class="btn btn--primary" data-acao="novo-equip">Cadastrar o primeiro</button></div>';
      el.innerHTML = html; return;
    }
    html += lista.map(function (e) {
      var capa = LP.fotosDe(e)[0], ativo = e.ativo !== false, es = estoque(e);
      var precos = [];
      if (e.preco_semana) precos.push(LP.brl(e.preco_semana) + ' semana');
      if (e.preco_mes) precos.push(LP.brl(e.preco_mes) + ' mês');
      return '<div class="eq-card"' + (ativo ? '' : ' style="opacity:.75"') + '><div class="eq-top">' +
        (capa ? '<img class="eq-thumb" src="' + esc(capa) + '" alt="" loading="lazy"/>'
              : '<div class="eq-thumb" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg></div>') +
        '<div style="min-width:0"><div class="eq-nome">' + esc(e.nome) + '</div>' +
          '<div class="eq-linha">' + esc(LP.categoria(e.categoria_id)) + (e.marca ? ' · ' + esc(e.marca) : '') + (LP.fotosDe(e).length ? '' : ' · <span style="color:var(--amber)">sem foto</span>') + '</div>' +
          '<div class="eq-preco">' + (e.preco_dia ? esc(LP.brl(e.preco_dia)) + ' por dia' : '<span style="color:var(--red)">Sem preço da diária</span>') +
            (precos.length ? '<span style="color:var(--muted);font-weight:400"> · ' + esc(precos.join(' · ')) + '</span>' : '') + '</div>' +
          (ativo ? '<div class="eq-estoque' + (es.livres ? '' : ' zero') + '">' + es.livres + ' de ' + es.total + ' livre' + (es.livres === 1 ? '' : 's') + ' hoje' +
            (es.futuras ? '<span style="color:var(--amber);font-weight:400"> · ' + es.futuras + ' reservada' + (es.futuras > 1 ? 's' : '') + ' para depois</span>' : '') + '</div>'
            : '<div class="eq-estoque zero">Desativado: não aparece na vitrine nem nas novas locações</div>') +
        '</div></div>' +
        '<div class="eq-rodape">' +
          (ativo ? '<label class="chave"><input type="checkbox" data-eq-vitrine="' + esc(e.id) + '"' + (e.is_public ? ' checked' : '') + '/><i></i>Na vitrine</label>'
                 : '<button type="button" class="btn btn--ghost btn--sm" data-eq="reativar" data-id="' + esc(e.id) + '">Reativar</button>') +
          '<div class="btns"><button type="button" class="btn btn--ghost btn--sm" data-eq="editar" data-id="' + esc(e.id) + '">Editar</button>' +
          (ativo ? '<button type="button" class="link-perigo" data-eq="excluir" data-id="' + esc(e.id) + '">Excluir</button>' : '') + '</div>' +
        '</div></div>';
    }).join('');
    el.innerHTML = html;
  };

  /* ── formulário ─────────────────────────────────────────────── */
  function formHTML(e) {
    e = e || {};
    var sp = (e.specs && typeof e.specs === 'object') ? e.specs : {};
    var cats = (LP.st.categorias || []).map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === e.categoria_id ? ' selected' : '') + '>' + esc(c.nome) + '</option>';
    }).join('');
    return '<p class="wz-sub">Preencha o que souber. Os campos sem “(opcional)” são necessários para alugar.</p>' +
      '<div class="lp-card"><h2>O que é</h2><p class="sub">Como o cliente vai encontrar o equipamento.</p>' +
        LP.campo('eqNome', 'Nome do equipamento', e.nome, { ph: 'Ex.: Betoneira 400 litros', max: 120, dica: 'Escreva como o cliente procura. Ex.: “Andaime tubular 1,5 m”.' }) +
        '<div class="fg" id="fg_eqCat"><label class="field-label" for="eqCat">Categoria</label><select class="field-select" id="eqCat">' +
          '<option value=""' + (e.categoria_id ? '' : ' selected') + '>Escolha a categoria…</option>' + cats + '</select><div class="fg-erro" hidden></div></div>' +
        '<div class="fg"><div class="field-label">Fotos <span class="opc" id="eqFotosN"></span></div><div class="eq-fotos" id="eqFotos"></div>' +
          '<div class="field-hint" style="margin-top:.4rem">Até 5 fotos. A primeira é a capa na vitrine. Foto boa vende mais: equipamento limpo, fundo simples.</div></div>' +
      '</div>' +
      '<div class="lp-card"><h2>Preço e quantidade</h2><p class="sub">O valor da locação é calculado pela diária × dias × quantidade.</p>' +
        '<div class="lp-2col">' +
          LP.campo('eqDia', 'Valor da diária (R$)', numTxt(e.preco_dia), { inputmode: 'decimal', ph: 'Ex.: 80,00' }) +
          LP.campo('eqQtd', 'Quantas unidades você tem', e.quantidade || 1, { inputmode: 'numeric', ph: 'Ex.: 2' }) +
        '</div><div class="lp-2col">' +
          LP.campo('eqSemana', 'Valor por semana (R$)', numTxt(e.preco_semana), { inputmode: 'decimal', opc: 1, ph: 'Ex.: 400,00' }) +
          LP.campo('eqMes', 'Valor por mês (R$)', numTxt(e.preco_mes), { inputmode: 'decimal', opc: 1, ph: 'Ex.: 1.200,00' }) +
        '</div>' +
        LP.campo('eqCaucao', 'Caução (R$)', numTxt(e.caucao), { inputmode: 'decimal', opc: 1, ph: 'Ex.: 300,00', dica: 'Valor que o cliente deixa de garantia e recebe de volta na devolução.' }) +
      '</div>' +
      '<div class="lp-card"><h2>Detalhes</h2><p class="sub">Ajudam o cliente a decidir sem precisar perguntar.</p>' +
        LP.campo('eqDesc', 'Descrição', e.descricao, { area: 1, opc: 1, max: 1000, ph: 'Ex.: Motor 2 cv, 220 V. Bem conservada, revisada a cada locação.' }) +
        LP.campo('eqCond', 'Condições de aluguel', sp.condicoes, { area: 1, linhas: 2, opc: 1, max: 600, ph: 'Ex.: Mínimo de 2 diárias. Retirada com documento e comprovante de endereço.' }) +
        LP.campo('eqInfo', 'Informações adicionais', sp.info, { area: 1, linhas: 2, opc: 1, max: 600, ph: 'Ex.: Acompanha mangueira e chave. Peso 90 kg.' }) +
        '<div class="lp-2col">' +
          LP.campo('eqMarca', 'Marca', e.marca, { opc: 1, max: 60, ph: 'Ex.: Menegotti' }) +
          LP.campo('eqModelo', 'Modelo', e.modelo, { opc: 1, max: 60 }) +
        '</div>' +
      '</div>' +
      '<label class="lp-check"><input type="checkbox" id="eqPub"' + (e.id ? (e.is_public ? ' checked' : '') : ' checked') + '/><span><strong>Mostrar na vitrine</strong> — o equipamento aparece na sua página pública com preço e botão de WhatsApp.</span></label>';
  }

  function serial() {
    return ['eqNome', 'eqCat', 'eqDia', 'eqQtd', 'eqSemana', 'eqMes', 'eqCaucao', 'eqDesc', 'eqCond', 'eqInfo', 'eqMarca', 'eqModelo']
      .map(v).join('|') + '|' + (q('eqPub') && q('eqPub').checked) + '|' + f.fotos.join(',');
  }

  LP.equipForm = function (id) {
    var e = id ? LP.equip(id) : null;
    if (id && !e) { LP.toast('Equipamento não encontrado. Atualize a página.'); return; }
    f.editando = e; f.fotos = e ? LP.fotosDe(e) : []; f.novas = []; f.removidas = []; f.enviando = 0;
    LP.tela.abrir({
      titulo: e ? 'Editar equipamento' : 'Novo equipamento',
      html: formHTML(e),
      rodape: '<button type="button" class="btn btn--ghost" data-eq="cancelar">Cancelar</button>' +
              '<button type="button" class="btn btn--primary" data-eq="salvar" id="eqSalvar">' + (e ? 'Salvar alterações' : 'Salvar equipamento') + '</button>',
      guarda: function () { return serial() !== f.inicial || f.enviando > 0; },
      aoFechar: function () {
        /* o que subiu neste formulário e não foi salvo sai do bucket */
        if (!f.salvo) f.novas.forEach(function (u) { FIELDO_LOCACAO.Fotos.apagar(u); });
        f.salvo = false;
      },
    });
    renderFotos();
    f.inicial = serial();
    if (!e) setTimeout(function () { var n = q('eqNome'); if (n) n.focus(); }, 80);
  };

  function renderFotos() {
    var wrap = q('eqFotos'); if (!wrap) return;
    var lim = FIELDO_LOCACAO.Fotos.LIMITE_POR_EQUIP;
    var html = f.fotos.map(function (url, i) {
      return '<div class="eq-foto"><img src="' + esc(url) + '" alt="Foto ' + (i + 1) + '"/>' +
        '<button type="button" class="eq-x" aria-label="Remover foto ' + (i + 1) + '" data-eq="foto-x" data-i="' + i + '">×</button>' +
        (i === 0 ? '<span class="eq-capa atual">Capa</span>' : '<button type="button" class="eq-capa" data-eq="foto-capa" data-i="' + i + '">Usar como capa</button>') + '</div>';
    }).join('');
    for (var k = 0; k < f.enviando; k++) html += '<div class="eq-foto pendente">Enviando…</div>';
    if (f.fotos.length + f.enviando < lim) html += '<button type="button" class="eq-foto-add" data-eq="foto-add">+ Adicionar foto</button>';
    wrap.innerHTML = html;
    q('eqFotosN').textContent = f.fotos.length ? '(' + f.fotos.length + ' de ' + lim + ')' : '(opcional)';
  }

  q('inpFotosEquip').addEventListener('change', function () {
    var lim = FIELDO_LOCACAO.Fotos.LIMITE_POR_EQUIP, livres = lim - f.fotos.length - f.enviando;
    var files = Array.prototype.slice.call(this.files || [], 0);
    this.value = '';
    if (!files.length) return;
    if (files.length > livres) LP.toast('Cabem mais ' + livres + (livres === 1 ? ' foto.' : ' fotos.') + ' As outras ficaram de fora.');
    files.slice(0, Math.max(0, livres)).forEach(function (file) {
      f.enviando++; renderFotos();
      FIELDO_LOCACAO.Fotos.enviarEquipamento(file)
        .then(function (url) { f.fotos.push(url); f.novas.push(url); })
        .catch(function (err) { LP.toast(err && err.message ? err.message : 'Não foi possível enviar a foto.'); console.error(err); })
        .then(function () { f.enviando--; renderFotos(); });
    });
  });

  function salvar() {
    var nome = v('eqNome'), cat = v('eqCat'), dia = LP.num(v('eqDia')), qtd = parseInt(v('eqQtd'), 10);
    ['eqNome', 'eqCat', 'eqDia', 'eqQtd', 'eqSemana', 'eqMes', 'eqCaucao'].forEach(function (id) { LP.marcarErro(id, ''); });
    if (nome.length < 2) return LP.marcarErro('eqNome', 'Informe o nome do equipamento.');
    if (!cat) return LP.marcarErro('eqCat', 'Escolha a categoria.');
    if (dia == null || dia <= 0) return LP.marcarErro('eqDia', 'Informe o valor da diária. Ex.: 80,00');
    if (isNaN(qtd) || qtd < 1 || qtd > 9999) return LP.marcarErro('eqQtd', 'Informe quantas unidades você tem (1 ou mais).');
    var ext = {};
    var opcionais = [['eqSemana', 'preco_semana'], ['eqMes', 'preco_mes'], ['eqCaucao', 'caucao']];
    for (var i = 0; i < opcionais.length; i++) {
      var bruto = v(opcionais[i][0]), n = LP.num(bruto);
      if (bruto && (n == null || n < 0)) return LP.marcarErro(opcionais[i][0], 'Use só números. Ex.: 400,00');
      ext[opcionais[i][1]] = bruto ? n : null;
    }
    if (f.enviando > 0) { LP.toast('Espere as fotos terminarem de enviar.'); return; }
    var e = f.editando, specs = Object.assign({}, (e && e.specs && typeof e.specs === 'object') ? e.specs : {});
    specs.condicoes = v('eqCond') || undefined; specs.info = v('eqInfo') || undefined;
    Object.keys(specs).forEach(function (k) { if (specs[k] === undefined) delete specs[k]; });
    var payload = {
      nome: nome, categoria_id: cat, preco_dia: dia, quantidade: qtd,
      preco_semana: ext.preco_semana, preco_mes: ext.preco_mes, caucao: ext.caucao,
      descricao: v('eqDesc') || null, marca: v('eqMarca') || null, modelo: v('eqModelo') || null,
      specs: specs, is_public: q('eqPub').checked, ativo: true,
      fotos: f.fotos.slice(0, FIELDO_LOCACAO.Fotos.LIMITE_POR_EQUIP),
    };
    var b = q('eqSalvar'); b.disabled = true; b.textContent = 'Salvando…';
    var removidas = f.removidas.slice();
    (e ? FIELDO_LOCACAO.Equipamentos.update(e.id, payload) : FIELDO_LOCACAO.Equipamentos.create(payload))
      .then(function () {
        removidas.forEach(function (u) { FIELDO_LOCACAO.Fotos.apagar(u); });
        f.salvo = true;
        var primeiro = !e && !(LP.st.equip || []).length;
        LP.toast(e ? 'Alterações salvas.' : (payload.is_public ? 'Equipamento cadastrado. Ele já aparece na sua vitrine.' : 'Equipamento cadastrado.'), 3500);
        return LP.tela.fecharSalvo().then(function () {
          return LP.recarregar().then(function () { if (primeiro && LP.abaAtual !== 'equipamentos') LP.ir('equipamentos'); });
        });
      })
      .catch(function (err) {
        b.disabled = false; b.textContent = e ? 'Salvar alterações' : 'Salvar equipamento';
        LP.falhou(err, 'salvar o equipamento');
      });
  }

  function usosEm(id) {
    return (LP.st.locacoes || []).filter(function (l) {
      return (l.locacao_itens || []).some(function (it) { return it.equipamento_id === id; });
    }).length;
  }

  function excluir(id) {
    var e = LP.equip(id); if (!e) return;
    var usos = usosEm(id);
    if (usos) {
      LP.confirmar({ titulo: 'Desativar “' + e.nome + '”?', ok: 'Desativar',
        texto: 'Este equipamento aparece em ' + LP.plural(usos, 'locação', 'locações') + '. Para não perder esse histórico, ele não pode ser apagado. Desativado, ele sai da vitrine e das novas locações; dá para reativar quando quiser.' })
        .then(function (ok) {
          if (!ok) return;
          FIELDO_LOCACAO.Equipamentos.update(id, { ativo: false, is_public: false })
            .then(function () { LP.toast('Equipamento desativado.'); return LP.recarregar(); })
            .catch(function (err) { LP.falhou(err, 'desativar'); });
        });
      return;
    }
    LP.confirmar({ titulo: 'Excluir “' + e.nome + '”?', texto: 'Ele sai da vitrine e do cadastro. Não dá para desfazer.', ok: 'Excluir', perigo: true })
      .then(function (ok) {
        if (!ok) return;
        FIELDO_LOCACAO.Equipamentos.remove(id)
          .then(function () { LP.fotosDe(e).forEach(function (u) { FIELDO_LOCACAO.Fotos.apagar(u); }); LP.toast('Equipamento excluído.'); return LP.recarregar(); })
          .catch(function (err) { LP.falhou(err, 'excluir'); });
      });
  }

  document.addEventListener('change', function (ev) {
    var c = ev.target;
    if (!c || !c.hasAttribute || !c.hasAttribute('data-eq-vitrine')) return;
    var id = c.getAttribute('data-eq-vitrine'), on = c.checked;
    c.disabled = true;
    FIELDO_LOCACAO.Equipamentos.update(id, { is_public: on })
      .then(function () { LP.toast(on ? 'Agora aparece na vitrine.' : 'Saiu da vitrine.'); return LP.recarregar(); })
      .catch(function (err) { c.checked = !on; c.disabled = false; LP.falhou(err, 'atualizar'); });
  });

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-eq]');
    if (!b) return;
    var a = b.getAttribute('data-eq'), i = +b.getAttribute('data-i');
    if (a === 'editar') LP.equipForm(b.getAttribute('data-id'));
    else if (a === 'excluir') excluir(b.getAttribute('data-id'));
    else if (a === 'reativar') {
      FIELDO_LOCACAO.Equipamentos.update(b.getAttribute('data-id'), { ativo: true })
        .then(function () { LP.toast('Equipamento reativado. Ligue “Na vitrine” se quiser mostrá-lo.'); return LP.recarregar(); })
        .catch(function (err) { LP.falhou(err, 'reativar'); });
    }
    else if (a === 'cancelar') LP.tela.fechar();
    else if (a === 'salvar') salvar();
    else if (a === 'foto-add') q('inpFotosEquip').click();
    else if (a === 'foto-x') {
      var url = f.fotos.splice(i, 1)[0], n = f.novas.indexOf(url);
      if (n !== -1) { f.novas.splice(n, 1); FIELDO_LOCACAO.Fotos.apagar(url); } else f.removidas.push(url);
      renderFotos();
    }
    else if (a === 'foto-capa') { f.fotos.unshift(f.fotos.splice(i, 1)[0]); renderFotos(); }
  });
})();
