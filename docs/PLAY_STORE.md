# Fieldo na Google Play — o que foi feito e o passo a passo (v12.45)

## Como o app funciona

O app Android é o próprio site `fieldo-zelo.com.br` aberto pelo Chrome em tela cheia, sem barra de
endereço (Trusted Web Activity, o formato que o Google recomenda para PWA). Consequências:

- **Publicar o site atualiza o app.** Não existe código de tela no Android. O projeto em `android/` só
  muda quando mudam o ícone, o endereço inicial, o nome do pacote ou a exigência de versão da Play.
- Câmera, galeria, Pix, WhatsApp, Studio e login funcionam como no Chrome do celular.
- Links do Fieldo tocados no WhatsApp abrem dentro do app, se ele estiver instalado.
- Celular sem Chrome compatível: o app abre o site numa aba do navegador (com barra), nunca numa
  WebView.

| Item | Valor |
|---|---|
| Pacote (não muda nunca depois de publicado) | `br.com.fieldozelo.app` |
| Endereço inicial | `https://fieldo-zelo.com.br/painel.html?app=play` |
| Android mínimo | 7.0 (API 24) — exigência da biblioteca do Google |
| Android alvo | 16 (API 36) — obrigatório para app novo desde 31/08/2026 |
| Versão | `versionCode 1`, `versionName 12.45` |
| Tamanho | AAB 0,98 MB |

## O bloqueio que foi resolvido: venda do Pro dentro do app

A política de pagamentos da Play não deixa um app vender assinatura de recurso digital (o Pro) por
fora do Google Play Billing, nem indicar onde comprar fora (link, botão, "fale com a equipe para
assinar"). O Pro é vendido pelo Asaas. Publicar o site como está seria motivo de recusa ou remoção.

O que a política permite é o app **dar acesso** a um plano comprado em outro lugar. Então, quando o
Fieldo é aberto pelo app (`app-play.js`):

- quem é Pro continua Pro;
- links e botões para `planos.html` e `ativar.html` somem, inclusive "Ativar Pro" e "Falar com a
  equipe" do aviso de limite; abrir essas páginas leva ao painel;
- no navegador (o site), nada muda: a venda continua lá.

Testado no navegador: no modo app, 0 links de compra visíveis no painel e no Studio; no site, os
mesmos links aparecem.

**O custo:** quem só usa o app não tem como virar Pro por ele. Para vender dentro do app é preciso
integrar o Google Play Billing, e o Google fica com uma parte de cada assinatura (de 10% a 15%,
conforme a regra em vigor; confira no Play Console antes de decidir). O Brasil também permite "faturamento por escolha do usuário" (Asaas ao lado do Google, com
taxa 4 pontos menor), mas ele exige a integração do Play Billing do mesmo jeito. Fica para uma
segunda fase, se o app trouxer volume.

## Passo a passo

### 1. Publicar o site v12.45 (antes de tudo)

O zip leva `app-play.js` e o arquivo que liga o app ao site. Depois de publicar, confira no navegador:
`https://fieldo-zelo.com.br/.well-known/assetlinks.json` precisa mostrar um JSON com
`br.com.fieldozelo.app`. Se der "Página não encontrada", o app abre com a barra de endereço do Chrome.

O arquivo fica em `well-known/` (sem ponto), com uma regra no `netlify.toml` que o serve no endereço
com ponto: o deploy por zip do Netlify descarta pastas que começam com ponto.

### 2. Conta de desenvolvedor

[play.google.com/console](https://play.google.com/console), taxa única de US$ 25.

- **Conta pessoal criada depois de 13/11/2023:** antes de publicar, é obrigatório um teste fechado
  com **pelo menos 12 testadores por 14 dias seguidos**. Conte duas semanas e 15–20 pessoas
  (profissionais que já usam o Fieldo são os testadores ideais), porque quem sai no meio pode custar
  o prazo.
- **Conta de organização** (precisa de CNPJ e número D-U-N-S, gratuito): não tem a regra dos 12
  testadores e mostra a empresa como desenvolvedora. Se o Fieldo tem CNPJ, é o caminho melhor.

### 3. Criar o app e enviar o AAB

1. Criar app → nome "Fieldo", idioma português (Brasil), App, Gratuito.
2. Teste → Teste fechado → criar versão → enviar `fieldo-12.45.aab`.
3. Aceitar a **Assinatura de apps do Google Play** (padrão). O Google guarda a chave de assinatura;
   a sua chave (`fieldo-upload.jks`) é só a de envio.

### 4. Colocar a impressão digital da Play no site (obrigatório)

Depois do primeiro envio: Play Console → Testar e lançar → **Integridade do app** → Assinatura de
apps → copie o **SHA-256 do certificado da chave de assinatura do app**.

Ele tem de entrar em `site/well-known/assetlinks.json`, ao lado da impressão que já está lá (a da
chave de envio, para testar o APK fora da loja):

```json
"sha256_cert_fingerprints": [
  "78:04:10:46:18:31:0D:9D:25:60:C5:F6:50:A6:0D:66:E4:47:E9:85:9B:25:A6:F2:87:E6:88:36:C4:4E:12:6E",
  "COLE:AQUI:O:SHA-256:DA:PLAY"
]
```

Publique o site de novo. **Sem isso, o app baixado da Play abre com a barra de endereço.** É o erro
mais comum nesse tipo de app.

### 5. Ficha da loja (`play/ficha/`)

- **Nome (até 30):** `Fieldo: orçamento e relatório`
- **Descrição curta (até 80):** `Orçamento, relatório com Pix e perfil público para autônomos.`
- **Descrição completa:**

  > O Fieldo é a ferramenta de trabalho do profissional autônomo: eletricista, pedreiro, pintor,
  > encanador, diarista, técnico de ar-condicionado e quem mais presta serviço.
  >
  > • Orçamento pronto em um minuto, com link para o cliente aprovar pelo WhatsApp.
  > • Registro de cada serviço com foto e data, mesmo sem sinal na obra.
  > • Relatório para o cliente com o valor e o Pix já preenchido: ele paga sem pedir sua chave.
  > • Avaliação de quem contratou, ligada a um serviço registrado. Não dá para comprar nem inflar.
  > • Perfil público com o seu trabalho, que pode aparecer no Google quando alguém procura a sua
  >   profissão na sua cidade.
  > • Fieldo Studio: transforme as fotos do serviço em vídeo para Instagram e WhatsApp, com
  >   trilhas compostas para o Fieldo.
  > • Contratos de diária e empreitada para a sua equipe.
  >
  > Grátis para começar, sem cartão. O cliente não precisa baixar nada: recebe um link.

- **Ícone:** `icone-512.png`. **Imagem de destaque:** `destaque-1024x500.png`.
- **Capturas de celular:** `captura-1.png` a `captura-5.png` (1080×1920, telas reais do app com
  dados de exemplo).
- **Categoria:** Empresas (Business). **E-mail de contato:** o de suporte. **Site:**
  `https://fieldo-zelo.com.br`.

### 6. Conteúdo do app (formulários obrigatórios)

- **Política de privacidade:** `https://fieldo-zelo.com.br/privacidade.html`
- **Acesso ao app:** o app exige login. Crie em produção uma conta só para o revisor do Google (com
  um serviço registrado de exemplo) e informe e-mail e senha. Sem isso a revisão é recusada.
- **Anúncios:** não contém.
- **Classificação de conteúdo:** questionário IARC; app de produtividade, sem violência, sem
  conteúdo gerado sem moderação para menores → classificação Livre/L esperada. Responda você.
- **Público-alvo:** 18 anos ou mais (a política de privacidade já apaga conta de menor).
- **Exclusão de conta:** dentro do app, Configurações → Seus dados → "Pedir exclusão da conta". Link
  na web: `https://fieldo-zelo.com.br/meus-dados.html` (pede login; também aceita o pedido pelo
  WhatsApp do suporte). A Play exige que o pedido seja atendido: hoje é manual, em até 15 dias.
- **Recursos financeiros:** o app gera código Pix para o cliente pagar o profissional, mas não é banco,
  carteira nem empréstimo → "o app não oferece recursos financeiros". Confirme lendo as opções.
- **Segurança dos dados** (rascunho, **confira com a política de privacidade antes de enviar**):

  | Tipo de dado | Coletado | Para quê | Compartilhado |
  |---|---|---|---|
  | Nome, e-mail, telefone | sim | conta, perfil público | não |
  | Fotos | sim | relatórios, perfil, Studio | não |
  | Outro conteúdo do usuário (serviços, orçamentos, avaliações) | sim | funcionalidade | não |
  | Dados dos clientes do profissional (nome, telefone, endereço) | sim | funcionalidade | não |
  | Outras informações financeiras (chave Pix do profissional) | sim | funcionalidade | não |
  | Interações no app / IP de acesso | sim | segurança, exigência do Marco Civil | não |

  Dados criptografados em trânsito: sim. Pedido de exclusão: sim. O CPF/CNPJ do Asaas não entra:
  dentro do app não há assinatura.

### 7. Teste fechado → produção

Com 12+ testadores por 14 dias (conta pessoal), peça acesso à produção pelo Painel. A primeira
revisão costuma levar de alguns dias a uma semana.

## Testar antes da loja

`fieldo-12.45.apk` é o mesmo app, assinado com a chave de envio, para instalar direto num Android
(permitir "instalar apps desconhecidos"). Depois do passo 1, ele já abre sem barra de endereço,
porque a impressão da chave de envio já está no `assetlinks.json`.

## Chave de envio (`fieldo-upload.jks`)

Está FORA do repositório, de propósito. Guarde o arquivo e a senha num lugar seguro (gerenciador
de senhas). Se perder, o app continua na loja (a chave de assinatura é do Google) e dá para pedir uma
chave de envio nova no Play Console, mas leva dias.

## Gerar uma versão nova do app

Só quando mudar algo em `android/`:

1. Suba `versionCode` (e `versionName`) em `android/app/build.gradle`.
2. Crie `android/keystore.properties` com `storeFile`, `storePassword`, `keyAlias=fieldo-upload` e
   `keyPassword`.
3. `cd android && ./gradlew bundleRelease` (JDK 17+ e Android SDK 36) →
   `app/build/outputs/bundle/release/app-release.aab`.

## O que não foi testado

- **O app instalado num celular de verdade.** Não há aparelho nem emulador com aceleração aqui. A
  compilação, a assinatura, o pacote, o Android 16 (API 36) e o arquivo de vínculo foram conferidos
  por ferramenta, não na mão. Faça o teste do APK antes de chamar os testadores.
- A regra do `netlify.toml` para `/.well-known/assetlinks.json` foi testada no ambiente local
  (nginx), não no Netlify. Confira o endereço depois de publicar (passo 1).
