# Fieldo Studio v2 e vídeo no relatório (v12.43)

## O que mudou para o profissional

**Relatório de serviço**
- Até 3 vídeos por relatório, de até 30 s cada (gravar na hora ou escolher da galeria).
- Vídeo maior que 30 s: o app abre um corte, a pessoa escolhe o trecho e ele é regravado em 720p
  no próprio celular (leva o tempo do trecho). Arquivo acima de 45 MB passa pelo mesmo caminho.
- O cliente assiste no relatório (player com capa, sem baixar o vídeo inteiro ao abrir a página).

**Studio** — ferramentas em abas, no estilo dos editores de vídeo de celular, com desfazer/refazer:

| Aba | O que faz |
|---|---|
| Mídia | modelo; vídeos do serviço com corte (início/fim), velocidade 0,5× a 2× e volume do som original; fotos, capa, antes e depois; avaliação |
| Música | 34 trilhas compostas (3 originais + 31 novas) filtradas por gênero; música do celular com escolha do trecho; volume; "abaixar a música quando o vídeo tiver som" |
| Cenas | linha do tempo: ordem, ocultar, duração, texto por cena e transição por cena |
| Texto | título; estilo do texto nas cenas (legenda, destaque, caixa) |
| Estilo | 7 filtros de cor; 8 transições; cor de destaque e marca (Pro) |
| Final | 5 encerramentos (cartão, WhatsApp, contato, só a marca, sem final); QR e link do perfil opcionais |

## As 31 trilhas novas

Compostas nota a nota em `site/studio-trilhas-catalogo.js` (partitura em texto) e sintetizadas no
aparelho. Nenhum arquivo de áudio, nada a licenciar, nenhuma melodia copiada.

Gêneros escolhidos pela pesquisa de 21/11/2026: funk é o gênero mais presente nas 50 mais ouvidas
do 1º semestre de 2026, seguido de forró e subgêneros; #brazilianfunk cresceu 34% no TikTok em 2026
e o phonk brasileiro 62% na Europa; o sertanejo voltou ao topo das paradas.

Funk (Baile da Laje, Pancadão, Melody Noturno) · Phonk (Fumaça na Pista) · Brega funk (Recife
Cintilante) · Piseiro · Forró · Arrocha · Sertanejo (Estrada de Terra, Arrasta pra Cima) · Pagode ·
Axé · Bossa nova · MPB · Afro house · Amapiano · House (Galpão, Fim de Tarde) · Eletrônica (Céu de
Neon, Brisa, Avenida Retrô) · Jersey club · Reggaeton · Trap · Lo-fi · Pop · Alegre (ukulele) ·
Corporativo · Cinemático · Rock · Natal.

Mixagem: todas medidas no navegador e equilibradas para o mesmo volume percebido no alto-falante de
celular (−21,5 dB ± 0,9, com filtro de 150 Hz), pico ≤ −1 dB, sem clipping. Geração de 15 s: 0,9 a
4,6 s num computador (no celular, espere 2 a 3× mais).

## Ordem de publicação (importante)

1. Republicar a Edge Function `admin-migracoes` e a página `admin-migracoes.html` (a lista fechada
   ganhou as duas migrations novas).
2. Aplicar no banco, pelo painel, nesta ordem:
   - `2026-11-21_locacao_precos_periodo.sql`
   - `2026-11-21_studio_v2_videos.sql` — cria `reports.videos`, o bucket `videos` e o Studio v2.
3. Só então publicar o resto do site. O site novo grava `videos` em `reports`; sem a migration, falha.

O painel confere sozinho se a migration já está aplicada (coluna, função e bucket).

## Verificado

- Banco: 19 casos do validador de roteiro e de `reports.videos` (`infra/tests/studio_roteiro.sql`),
  incluindo roteiro v1 antigo continuar válido e recusa de URL `javascript:`, texto com HTML, clipe
  acima de 30 s, vídeo de outro serviço.
- Navegador (Chromium, 390 px e 1280 px): relatório com vídeo de 12 s e de 45 s (cortado para 30 s),
  upload, página do cliente com os dois players; Studio passando por todas as abas, música do
  celular, desfazer/refazer, e MP4 gerado (1080×1920, 30 fps, 17,4 s, com áudio) conferido quadro a
  quadro com ffprobe/ffmpeg.
- Um bug real foi pego no teste: a constraint de `reports.videos` chamava uma função sem permissão
  para `authenticated` — **toda criação de relatório teria falhado em produção**. Corrigido na
  migration antes de qualquer publicação.

## Limites conhecidos

- A duração de 30 s é conferida no aparelho; o banco não abre o arquivo. O teto duro é o do bucket
  (50 MB por arquivo).
- O corte de vídeo usa MediaRecorder em tempo real. Navegador sem MediaRecorder: a pessoa precisa
  cortar o vídeo na galeria antes.
- Filtros de cor dependem de `ctx.filter` no canvas; Safari antigo mostra sem filtro.
- Música do celular: o Fieldo avisa, mas não verifica direitos autorais. Instagram/TikTok podem
  silenciar o vídeo. As trilhas do Fieldo não têm esse risco.
- A música do celular não é salva: ao reabrir um vídeo, a pessoa escolhe o arquivo de novo.
- No teste local o áudio saiu em Opus (o Chromium de teste não tem codificador AAC); no Chrome do
  Android sai AAC, como antes.
- O vídeo do relatório não aparece no perfil público (só no relatório do cliente e no Studio).
