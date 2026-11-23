/* ============================================================
   Fieldo · obra-contrato-doc.js  v12.40 — texto do contrato de obra
   ─────────────────────────────────────────────────────────────
   Monta o TEXTO do contrato de obra (empreitada) a partir dos dados.
   O mesmo módulo roda na tela do profissional, na página do cliente e
   no PDF: os três mostram exatamente o mesmo documento, e o SHA-256 do
   texto (calculado no servidor ao enviar) prova qual versão foi aceita.

   Formato: o mesmo de locacao/contrato-doc.js ("# " título, "## " seção,
   "### " cláusula, "- " item), para reaproveitar toHtml/blocos e o PDF.
   Depende de FieldoContratoDoc (locacao/contrato-doc.js) para formatar
   CPF/CNPJ, telefone, datas e valores.

   Base legal usada no texto (Código Civil, Lei 10.406/2002):
     arts. 610 a 626  empreitada (de lavor ou com materiais, art. 610);
     art. 618         responsabilidade de 5 anos pela solidez e segurança
                      em edifícios e construções consideráveis;
     art. 619         acréscimo de preço só com autorização escrita;
     art. 623         dono da obra pode suspender pagando o já executado.
   Código de Defesa do Consumidor (Lei 8.078/1990), art. 26, II: 90 dias
   para reclamar de vício aparente em serviço durável.
   Assinatura eletrônica: Lei 14.063/2020 (art. 4º, I) e MP 2.200-2/2001
   (art. 10, § 2º).

   IMPORTANTE — é um modelo genérico para obras e reformas residenciais.
   Obra grande, com projeto, ART/RRT ou alvará, pede revisão jurídica e
   técnica específica. A tela avisa isso ao profissional.
============================================================ */
var ObraContratoDoc = (function () {
  'use strict';

  var D = (typeof FieldoContratoDoc !== 'undefined') ? FieldoContratoDoc : null;

  var ACEITE_VERSAO = 'aceite-obra-v1';
  var ACEITE_CONTRATANTE =
    'Li o contrato acima, conferi os dados da obra, o valor e as condições de pagamento e concordo com os seus termos. ' +
    'Reconheço que o meu aceite eletrônico, com data, hora e demais informações técnicas, será registrado como evidência da contratação.';
  var ACEITE_CONTRATADA =
    'Li o contrato acima, confirmo os meus dados e os da obra e concordo com os seus termos. Reconheço que o meu aceite ' +
    'eletrônico, com data, hora e demais informações técnicas, será registrado como evidência da contratação.';

  var MATERIAIS = {
    contratante: 'Os materiais são fornecidos pelo CONTRATANTE. A CONTRATADA fornece a mão de obra e as ferramentas (empreitada de lavor, art. 610 do Código Civil).',
    contratada: 'Os materiais são fornecidos pela CONTRATADA e estão incluídos no preço (empreitada com materiais, art. 610 do Código Civil).',
    misto: 'Os materiais são fornecidos em parte por cada uma das partes, conforme descrito a seguir.'
  };

  function t(s) { return String(s == null ? '' : s).replace(/\r/g, '').trim(); }
  function linha(s) { return t(s).replace(/\s*\n+\s*/g, ' '); }
  function doc(s) { return D ? D.fmtDoc(s) : linha(s); }
  function docTipo(s) { var n = String(s || '').replace(/\D/g, '').length; return n === 14 ? 'CNPJ' : 'CPF'; }
  function tel(s) { return D ? D.fmtTel(s) : linha(s); }
  function brl(n) { return D ? D.brl(n) : ('R$ ' + Number(n || 0).toFixed(2)); }
  function data(s) { return D ? D.fmtData(s) : String(s || ''); }
  function hoje() {
    try {
      return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) { return ''; }
  }
  function g(o, caminho) {
    return caminho.split('.').reduce(function (a, k) { return a && a[k] != null ? a[k] : null; }, o);
  }

  /* ── o que falta para enviar (mesmas regras de _oc_faltam no banco) ── */
  function faltam(d) {
    var f = [];
    function add(campo, rotulo) { f.push({ campo: campo, rotulo: rotulo }); }
    var docOk = function (v) { return D ? D.docValido(v) : String(v || '').replace(/\D/g, '').length >= 11; };
    if (linha(g(d, 'contratada.nome')).length < 3) add('contratada.nome', 'Seu nome ou razão social');
    if (!docOk(g(d, 'contratada.documento'))) add('contratada.documento', 'Seu CPF ou CNPJ');
    if (linha(g(d, 'contratante.nome')).length < 3) add('contratante.nome', 'Nome do cliente');
    if (!docOk(g(d, 'contratante.documento'))) add('contratante.documento', 'CPF ou CNPJ do cliente');
    if (String(g(d, 'contratante.telefone') || '').replace(/\D/g, '').length < 10) add('contratante.telefone', 'Telefone do cliente');
    if (linha(g(d, 'obra.titulo')).length < 3) add('obra.titulo', 'Nome da obra');
    if (linha(g(d, 'obra.endereco')).length < 5) add('obra.endereco', 'Endereço da obra');
    if (t(g(d, 'obra.descricao')).length < 20) add('obra.descricao', 'O que será feito (pelo menos uma frase completa)');
    var ini = g(d, 'obra.inicio'), fim = g(d, 'obra.termino_previsto');
    if (!ini || !fim || fim < ini) add('obra.prazo', 'Início e término previsto (o término não pode ser antes do início)');
    var tot = Number(g(d, 'obra.valor_total'));
    if (!(tot > 0)) add('obra.valor_total', 'Valor total da obra');
    var parc = g(d, 'pagamento.parcelas') || [];
    if (parc.length) {
      var soma = parc.reduce(function (a, p) { return a + (Number(p.valor) || 0); }, 0);
      if (tot > 0 && Math.abs(soma - tot) > 0.009) add('pagamento.parcelas', 'As parcelas somam ' + brl(soma) + ', mas o total da obra é ' + brl(tot));
    }
    if (linha(g(d, 'condicoes.foro')).length < 3) add('condicoes.foro', 'Foro (cidade/UF)');
    return f;
  }

  /* ── texto do contrato ─────────────────────────────────────────── */
  function render(d, numero, versao) {
    var ct = d.contratada || {}, cl = d.contratante || {}, ob = d.obra || {}, pg = d.pagamento || {}, cd = d.condicoes || {};
    var L = [];
    function p(s) { if (t(s)) L.push(t(s)); }
    function h1(s) { L.push('# ' + linha(s)); }
    function h2(s) { L.push('## ' + linha(s)); }
    function h3(s) { L.push('### ' + linha(s)); }
    function li(s) { if (t(s)) L.push('- ' + linha(s)); }
    var n = 0;
    function clausula(titulo) { n++; h3('Cláusula ' + n + 'ª — ' + titulo); }

    h1('CONTRATO DE EMPREITADA DE OBRA');
    p('Contrato nº ' + numero + ' · versão ' + (versao || 1) + ' · emitido em ' + hoje());

    h2('Partes');
    p('CONTRATADA: ' + linha(ct.nome) + ', ' + docTipo(ct.documento) + ' ' + doc(ct.documento) +
      (ct.telefone ? ', telefone ' + tel(ct.telefone) : '') + (ct.cidade ? ', com atuação em ' + linha(ct.cidade) : '') + '.');
    p('CONTRATANTE: ' + linha(cl.nome) + ', ' + docTipo(cl.documento) + ' ' + doc(cl.documento) +
      (cl.telefone ? ', telefone ' + tel(cl.telefone) : '') + (cl.endereco ? ', residente em ' + linha(cl.endereco) : '') + '.');
    p('As partes acima celebram este contrato de empreitada, regido pelos artigos 610 a 626 do Código Civil e, quando houver relação de consumo, pelo Código de Defesa do Consumidor, nas condições a seguir.');

    h2('Condições');
    clausula('Objeto');
    p('A CONTRATADA executará a obra "' + linha(ob.titulo) + '", no endereço ' + linha(ob.endereco) + ', compreendendo:');
    p(t(ob.descricao));
    p('Serviço não descrito acima não faz parte deste contrato e, se pedido, será tratado como acréscimo (Cláusula ' + 6 + 'ª).');

    clausula('Materiais');
    p(MATERIAIS[cd.materiais] || MATERIAIS.contratante);
    if (t(cd.materiais_obs)) p(cd.materiais_obs);
    p('Quem fornece o material responde pela sua qualidade e pela entrega no prazo necessário ao andamento da obra.');

    clausula('Prazo');
    p('A obra começa em ' + data(ob.inicio) + ' e tem término previsto para ' + data(ob.termino_previsto) + '.');
    p('O prazo é prorrogado, pelo tempo do impedimento, em caso de chuva que impeça o trabalho, falta de material a cargo do CONTRATANTE, falta de acesso ao local, mudança pedida no serviço ou outro motivo que não dependa da CONTRATADA.');

    clausula('Preço');
    p('O valor total da obra é de ' + brl(ob.valor_total) + ', que inclui ' +
      (cd.materiais === 'contratada' ? 'mão de obra e materiais' : 'a mão de obra' + (cd.materiais === 'misto' ? ' e os materiais a cargo da CONTRATADA' : '')) + '.');

    clausula('Forma de pagamento');
    var parc = pg.parcelas || [];
    if (parc.length) {
      p('O pagamento será feito por ' + (linha(pg.forma) || 'Pix') + ', nas seguintes parcelas:');
      parc.forEach(function (x, i) {
        li(linha(x.descricao || ('Parcela ' + (i + 1))) + ': ' + brl(x.valor) + (t(x.quando) ? ' — ' + linha(x.quando) : ''));
      });
    } else {
      p('O pagamento será feito por ' + (linha(pg.forma) || 'Pix') + ', conforme as etapas concluídas e registradas pela CONTRATADA.');
    }
    p('Cada etapa concluída é registrada pela CONTRATADA no Fieldo, com descrição, fotos e valor, e enviada ao CONTRATANTE por link. O registro mostra o que já foi pago e quanto falta pagar da obra.');
    if (t(cd.multa_atraso)) {
      p('Atraso no pagamento: ' + linha(cd.multa_atraso));
    } else {
      p('Em caso de atraso no pagamento, o valor em atraso terá multa de 2% e juros de 1% ao mês, e a CONTRATADA poderá suspender os trabalhos depois de avisar o CONTRATANTE por escrito, com prazo de 5 dias.');
    }

    clausula('Alterações e acréscimos');
    p('Qualquer mudança no que foi combinado (acréscimo de serviço, troca de material, mudança de projeto) só vale se for feita por escrito, em nova versão deste contrato assinada pelas duas partes, com o novo preço e o novo prazo (art. 619 do Código Civil).');

    clausula('Obrigações da CONTRATADA');
    li('executar a obra com boa técnica, seguindo as normas técnicas aplicáveis;');
    li('manter o local organizado e retirar o entulho que produzir, salvo combinação diferente;');
    li('usar os equipamentos de proteção necessários e responder pela sua equipe;');
    li('avisar o CONTRATANTE, assim que perceber, de qualquer problema que afete a obra, o prazo ou o preço;');
    li('registrar cada etapa concluída e entregar ao CONTRATANTE o relatório correspondente.');

    clausula('Obrigações do CONTRATANTE');
    li('pagar nas datas combinadas;');
    li('garantir o acesso ao local nos dias e horários de trabalho;');
    li('fornecer, no prazo, os materiais que estiverem a seu cargo;');
    li('providenciar alvarás e autorizações de condomínio ou da prefeitura, quando exigidos, salvo combinação diferente.');

    clausula('Garantia');
    var gm = Number(cd.garantia_meses);
    p('A CONTRATADA garante os serviços executados ' + (gm > 0 ? 'por ' + gm + (gm === 1 ? ' mês' : ' meses') + ' a contar da entrega' : 'nos termos da lei') +
      ', comprometendo-se a corrigir, sem custo, defeitos de execução. A garantia não cobre mau uso, falta de manutenção, intervenção de terceiros nem defeito de material fornecido pelo CONTRATANTE.');
    p('Esta garantia se soma às garantias legais: o prazo de 90 dias para reclamar de vício aparente (art. 26, II, do Código de Defesa do Consumidor) e, em edifícios e construções consideráveis, a responsabilidade de 5 anos pela solidez e segurança da obra (art. 618 do Código Civil).');

    clausula('Rescisão');
    p('Qualquer parte pode encerrar este contrato se a outra descumprir uma obrigação e não corrigir em 10 dias depois de avisada por escrito.');
    p('O CONTRATANTE pode suspender a obra a qualquer tempo, pagando os serviços já executados e as despesas comprovadas até a data (art. 623 do Código Civil). Valores pagos por etapas ainda não executadas serão devolvidos.');

    clausula('Assinatura eletrônica e registro');
    p('As partes concordam em assinar este contrato eletronicamente. Cada assinatura fica registrada com nome, CPF ou CNPJ, data e hora, endereço IP, navegador usado e o código de integridade (SHA-256) deste texto, no termo de assinaturas que acompanha o contrato. As partes reconhecem esse meio como válido para comprovar a autoria e a integridade do documento (Lei 14.063/2020, art. 4º, I, e MP 2.200-2/2001, art. 10, § 2º).');
    p('Qualquer pessoa com o código de integridade pode conferir este contrato em fieldo-zelo.com.br/verificar.html. Alterar uma única letra do texto muda o código.');

    clausula('Foro');
    p('Fica eleito o foro da comarca de ' + linha(cd.foro) + ' para resolver questões deste contrato, sem prejuízo do direito do consumidor de propor ação no seu domicílio.');

    h2('Resumo');
    li('Obra: ' + linha(ob.titulo) + ' · ' + linha(ob.endereco));
    li('Período: ' + data(ob.inicio) + ' a ' + data(ob.termino_previsto));
    li('Valor total: ' + brl(ob.valor_total));
    li('CONTRATADA: ' + linha(ct.nome) + ' · ' + docTipo(ct.documento) + ' ' + doc(ct.documento));
    li('CONTRATANTE: ' + linha(cl.nome) + ' · ' + docTipo(cl.documento) + ' ' + doc(cl.documento));

    return L.join('\n');
  }

  return {
    ACEITE_VERSAO: ACEITE_VERSAO, ACEITE_CONTRATANTE: ACEITE_CONTRATANTE, ACEITE_CONTRATADA: ACEITE_CONTRATADA,
    render: render, faltam: faltam, docTipo: docTipo
  };
})();
