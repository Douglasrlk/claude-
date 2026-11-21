/* ============================================================
   Fieldo Locação · painel-inicio.js  v12.24 (cartão do assistente)
   Tela Início (primeiros passos + números do dia + atalhos) e Ajuda.
   Tudo é calculado do que existe no banco: sair e voltar, até em
   outro aparelho, nunca perde o progresso dos primeiros passos.
============================================================ */
(function () {
  'use strict';
  var esc = LP.esc;

  function passos() {
    var st = LP.st, l = st.locadora || {}, eq = st.equip || [];
    var ativos = eq.filter(function (e) { return e.ativo !== false; });
    var precosOk = ativos.length > 0 && ativos.every(function (e) { return Number(e.preco_dia) > 0 && (e.quantidade || 0) >= 1; });
    var naVitrine = ativos.some(function (e) { return e.is_public; });
    return [
      { id: 'perfil', feito: !!(l.nome && l.whatsapp && l.city && (l.logo_url || (l.bio && l.bio.trim()))),
        t: 'Configure os dados da sua locadora',
        d: 'Coloque sua foto ou logotipo e uma frase sobre a locadora. É o que o cliente vê primeiro na vitrine.',
        b: '<button type="button" class="btn btn--primary btn--sm" data-ir="perfil">Completar meu perfil</button>' },
      { id: 'equip', feito: eq.length > 0,
        t: 'Cadastre seu primeiro equipamento',
        d: 'Betoneira, andaime, gerador… Com foto e preço da diária. Leva um minuto.',
        b: '<button type="button" class="btn btn--primary btn--sm" data-acao="novo-equip">Cadastrar equipamento</button>' },
      { id: 'precos', feito: precosOk && naVitrine,
        t: 'Configure preços e disponibilidade',
        d: !eq.length ? 'Depois do primeiro equipamento: confira preço, quantidade e ligue “Na vitrine”.'
          : !precosOk ? 'Há equipamento sem preço da diária ou sem quantidade. Abra e complete.'
          : 'Ligue “Na vitrine” em pelo menos um equipamento para sua página aparecer para os clientes.',
        b: '<button type="button" class="btn btn--primary btn--sm" data-ir="equipamentos">Ver meus equipamentos</button>' },
      { id: 'locacao', feito: (st.locacoes || []).length > 0,
        t: 'Registre sua primeira locação',
        d: 'Anote quem levou o quê e quando devolve. O app avisa os atrasos e calcula o valor.',
        b: '<button type="button" class="btn btn--primary btn--sm" data-acao="nova-locacao">Registrar locação</button>' },
      { id: 'contrato', feito: LP.contratos().length > 0,
        t: 'Crie seu primeiro contrato',
        d: 'O contrato sai da locação com os dados já preenchidos. O cliente assina pelo celular.',
        b: '<button type="button" class="btn btn--primary btn--sm" data-acao="novo-contrato">Criar contrato</button>' },
    ];
  }

  function blocoPassos() {
    var ps = passos(), feitos = ps.filter(function (p) { return p.feito; }).length;
    if (feitos === ps.length && LP.ls('passos_ok') === '1') return '';
    if (feitos === ps.length) {
      return '<div class="lp-card"><h2>Tudo configurado</h2><p class="sub" style="margin-bottom:.6rem">Você completou os primeiros passos. Daqui em diante, esta tela mostra o movimento do dia.</p>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-acao="esconder-passos">Esconder este quadro</button></div>';
    }
    var prox = ps.filter(function (p) { return !p.feito; })[0];
    return '<div class="lp-card" id="primeirosPassos"><h2>Primeiros passos</h2>' +
      '<p class="sub" style="margin-bottom:.4rem">' + feitos + ' de ' + ps.length + ' concluídos. Faça na ordem; você pode parar e voltar quando quiser.</p>' +
      '<div class="lp-barra" aria-hidden="true"><i style="width:' + Math.round(feitos / ps.length * 100) + '%"></i></div>' +
      '<ol class="lp-passos">' + ps.map(function (p, i) {
        var cls = p.feito ? 'feito' : (p === prox ? 'proximo' : '');
        return '<li class="lp-passo ' + cls + '"><span class="lp-passo-n" aria-hidden="true">' + (p.feito ? '✓' : (i + 1)) + '</span>' +
          '<span class="lp-passo-t">' + esc(p.t) + (p.feito ? '<span class="sr-only"> (concluído)</span>' : '') + '</span>' +
          (p === prox ? '<span class="lp-passo-d"><strong>Próximo passo.</strong> ' + esc(p.d) + '</span><span class="lp-passo-a">' + p.b + '</span>'
            : '<span class="lp-passo-d">' + esc(p.d) + '</span><span class="lp-passo-a">' + p.b.replace('btn--primary', 'btn--ghost') + '</span>') +
        '</li>';
      }).join('') + '</ol></div>';
  }

  function agenda() {
    var hoje = LP.D.hojeLocal(), itens = [];
    LP.comStatus().forEach(function (x) {
      var l = x.loc, quem = '<b>' + esc(l.client_name) + '</b>';
      var oQue = (l.locacao_itens || []).map(function (it) { return (it.equipamentos && it.equipamentos.nome) || ''; }).filter(Boolean).join(', ');
      if (x.vis === 'atrasada') {
        var a = LP.diasEntre(l.data_prevista_devolucao, hoje);
        itens.push({ ord: -1000 + (-a), html: '<span class="o">' + quem + ' · ' + esc(oQue) + '</span><span class="q red">Atrasada ' + esc(LP.emDias(a)) + '</span>' });
      } else if (x.vis === 'em_andamento') {
        var r = LP.diasEntre(hoje, l.data_prevista_devolucao);
        if (r <= 7) itens.push({ ord: r, html: '<span class="o">' + quem + ' devolve ' + esc(oQue) + '</span><span class="q green">' + (r === 0 ? 'Hoje' : r === 1 ? 'Amanhã' : esc(LP.fmtData(l.data_prevista_devolucao))) + '</span>' });
      } else if (x.vis === 'reservada') {
        var s = LP.diasEntre(hoje, l.data_saida);
        if (s <= 7) itens.push({ ord: s + .5, html: '<span class="o">' + quem + ' retira ' + esc(oQue) + '</span><span class="q amber">' + (s === 0 ? 'Hoje' : s === 1 ? 'Amanhã' : esc(LP.fmtData(l.data_saida))) + '</span>' });
      }
    });
    itens.sort(function (a, b) { return a.ord - b.ord; });
    return itens;
  }

  LP.abas.inicio = function (el) {
    var st = LP.st, l = st.locadora || {}, c = LP.contagens(), ag = agenda();
    var nome = (l.nome || '').trim();
    var vitrineOn = !!l.is_public && !!l.slug;
    var html =
      '<div class="lp-cab"><div><h1>Olá' + (nome ? ', ' + esc(nome) : '') + '</h1>' +
      '<p>' + (c.atrasadas ? '<strong style="color:var(--red)">' + esc(LP.plural(c.atrasadas, 'locação atrasada', 'locações atrasadas')) + '.</strong> Comece por ela.'
        : 'Aqui está o resumo da sua locadora hoje.') + '</p></div></div>' +
      (LP.fielCartao ? LP.fielCartao() : '') +
      blocoPassos() +
      '<div class="lp-nums">' +
        '<button type="button" class="lp-num" data-ir="equipamentos"><b>' + (st.equip || []).length + '</b><span>equipamentos cadastrados</span></button>' +
        '<button type="button" class="lp-num" data-acao="filtro-loc" data-f="em_andamento"><b>' + c.emUso + '</b><span>locações em uso agora</span></button>' +
        '<button type="button" class="lp-num' + (c.atrasadas ? ' alerta' : '') + '" data-acao="filtro-loc" data-f="atrasada"><b>' + c.atrasadas + '</b><span>atrasadas</span></button>' +
        '<button type="button" class="lp-num' + (c.ctAssinar ? ' alerta' : '') + '" data-ir="contratos"><b>' + (c.ctAssinar + c.ctRascunho) + '</b><span>contratos esperando você</span></button>' +
      '</div>' +
      '<div class="lp-card"><h2>Próximos 7 dias</h2>' +
        (ag.length ? '<ul class="lp-agenda">' + ag.slice(0, 6).map(function (i) { return '<li>' + i.html + '</li>'; }).join('') + '</ul>' +
          (ag.length > 6 ? '<button type="button" class="link-acao" data-ir="locacoes">Ver todas</button>' : '')
          : '<p class="sub" style="margin:0">Nenhuma retirada, devolução ou atraso nos próximos 7 dias.</p>') +
      '</div>' +
      '<div class="lp-bloco-tit">Atalhos</div>' +
      '<div class="lp-atalhos">' +
        '<button type="button" class="btn btn--primary" data-acao="nova-locacao">+ Nova locação</button>' +
        '<button type="button" class="btn btn--ghost" data-acao="novo-equip">+ Novo equipamento</button>' +
        (vitrineOn ? '<a class="btn btn--wa-sec" target="_blank" rel="noopener" href="' + esc(LP.linkWhatsVitrine()) + '">' + LP.ICONE_WA + 'Enviar minha vitrine</a>'
          : '<button type="button" class="btn btn--ghost" data-ir="perfil">Minha vitrine</button>') +
      '</div>';
    el.innerHTML = html;
  };

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-acao]');
    if (!b) return;
    var a = b.getAttribute('data-acao');
    if (a === 'esconder-passos') { LP.ls('passos_ok', '1'); LP.renderAtual(); }
    else if (a === 'filtro-loc') { LP.st.filtroLoc = b.getAttribute('data-f'); LP.ir('locacoes'); }
    else if (a === 'novo-equip') { if (LP.equipForm) LP.equipForm(); }
    else if (a === 'nova-locacao') { if (LP.locWizard) LP.locWizard(); }
    else if (a === 'novo-contrato') { if (LP.novoContrato) LP.novoContrato(); }
    else if (a === 'rever-dicas') { LP.reverDicas(); LP.toast('As dicas e os primeiros passos voltaram a aparecer.'); LP.ir('inicio'); }
  });

  /* ── Ajuda ──────────────────────────────────────────────────── */
  LP.abas.ajuda = function (el) {
    el.innerHTML =
      '<div class="lp-cab"><div><h1>Ajuda</h1><p>Respostas curtas para as dúvidas mais comuns. Toque numa pergunta.</p></div></div>' +
      '<div class="aj">' +
      '<details open><summary>Por onde eu começo?</summary><div class="r"><p>Siga os <strong>Primeiros passos</strong> da tela Início, na ordem: perfil, equipamento, preços e vitrine, locação e contrato. Cada passo tem um botão que leva direto para a tarefa.</p>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-ir="inicio">Ir para o Início</button></div></details>' +
      '<details><summary>Como funciona a vitrine?</summary><div class="r"><p>A vitrine é uma página pública com seus equipamentos, preços e um botão de WhatsApp. Ela entra no ar sozinha quando pelo menos um equipamento está com <strong>“Na vitrine”</strong> ligado.</p><p>O link fica em <strong>Meu perfil</strong>. Mande para os clientes ou coloque no Instagram.</p></div></details>' +
      '<details><summary>O que significa cada situação da locação?</summary><div class="r"><dl>' +
        '<dt>Reservada</dt><dd>O cliente ainda não retirou. O equipamento já fica separado para essas datas.</dd>' +
        '<dt>Em uso</dt><dd>O cliente está com o equipamento. Quando ele devolver, toque em “Marcar devolvida”.</dd>' +
        '<dt>Atrasada</dt><dd>Passou do dia combinado e não foi devolvida. Use “Cobrar devolução” para mandar uma mensagem pronta pelo WhatsApp.</dd>' +
        '<dt>Devolvida</dt><dd>Encerrada. O equipamento volta a ficar livre.</dd>' +
        '<dt>Cancelada</dt><dd>Não aconteceu. O equipamento volta a ficar livre.</dd></dl></div></details>' +
      '<details><summary>Como o app sabe se o equipamento está livre?</summary><div class="r"><p>Ele olha as datas. Uma locação só ocupa o equipamento entre o dia da retirada e o da devolução. Se a locação atrasar, o equipamento continua ocupado até você marcar a devolução.</p></div></details>' +
      '<details><summary>O que significa cada situação do contrato?</summary><div class="r"><dl>' +
        '<dt>Rascunho</dt><dd>Você ainda está conferindo. Próximo passo: abrir, revisar e gerar o link.</dd>' +
        '<dt>Aguardando o cliente</dt><dd>O link foi gerado. Próximo passo: enviar pelo WhatsApp e esperar o cliente assinar.</dd>' +
        '<dt>Falta a sua assinatura</dt><dd>O cliente já assinou. Próximo passo: abrir o contrato e assinar como locadora.</dd>' +
        '<dt>Assinado</dt><dd>Concluído. Próximo passo: gerar o PDF e enviar ao cliente.</dd>' +
        '<dt>Recusado, cancelado ou substituído</dt><dd>Esta versão não vale mais. Se precisar, crie uma nova versão.</dd></dl></div></details>' +
      '<details><summary>Errei um dado num contrato já enviado. E agora?</summary><div class="r"><p>Contrato enviado ou assinado não pode ser alterado: é isso que garante que ninguém mude o texto depois. Abra o contrato e toque em <strong>“Criar nova versão”</strong>. A versão antiga fica guardada no histórico.</p></div></details>' +
      '<details><summary>Os dados da minha empresa saem no contrato?</summary><div class="r"><p>Sim. Preencha uma vez em <strong>Meu perfil → Dados para contratos</strong> (razão social, CPF ou CNPJ, endereço e condições). Todo contrato novo já nasce com eles. Esses dados não aparecem na vitrine.</p>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-ir="perfil" data-sub="pfContrato">Abrir Dados para contratos</button></div></details>' +
      '<details><summary>O que o assistente de IA faz?</summary><div class="r"><p>Você pede do jeito que fala, por texto ou pelo microfone, e ele faz: registra aluguel conferindo o estoque nas datas, renova, dá baixa na devolução, cadastra equipamento, muda preço e gera o link do contrato para o cliente assinar.</p>' +
        '<p>CPF, CNPJ, chave Pix e a sua assinatura no contrato ficam só com você, na tela. Cancelar um aluguel ele só faz depois do seu “sim”.</p><p>Faz parte do <strong>Pro da Locação</strong>, com 50 mensagens por mês.</p></div></details>' +
      '<details><summary>Troquei de celular. Como entro de novo?</summary><div class="r"><p>Na tela de entrada, use <strong>“Já tenho conta”</strong> com o seu e-mail e senha, ou com o código de recuperação de 16 caracteres.</p><p>Os dois ficam em <strong>Meu perfil → Acesso à conta</strong>. Guarde antes de trocar de aparelho.</p></div></details>' +
      '</div>' +
      '<div class="lp-card" style="margin-top:1rem"><h2>Ainda com dúvida?</h2><p class="sub">Fale com a gente. Respondemos pelo WhatsApp.</p>' +
        '<div class="lp-atalhos"><a class="btn btn--ghost" href="../suporte.html">Falar com o suporte</a>' +
        '<button type="button" class="btn btn--ghost" data-acao="rever-dicas">Mostrar as dicas de novo</button></div></div>';
  };
})();
