# Divulgação do Fieldo (artes + vídeo feito no Studio)

- `artes.html`: as 7 artes 1080×1920 (HTML/CSS, fontes e cores da marca). Duas versões:
  `post` (texto completo, para feed/stories) e `video` (faixa de baixo livre para a legenda do Studio).
- `render.js`: gera os PNG das duas versões com o Chromium do Playwright (`node render.js`).
- `studio_divulgacao.js`: conduz o Studio no ambiente local (`infra/`) como um usuário: capa, antes e
  depois, ordem das cenas, texto por cena, trilha "Dia Bom", transição, final em cartão sem QR/link,
  e baixa o MP4. Precisa de uma conta local "Fieldo" (Pro, marca d'água desligada) com um serviço
  público contendo as 7 artes da versão `video`.

Textos tirados do próprio site (home, FAQ, planos). Sem números inventados, sem depoimento de cliente.
O valor R$ 180,00 é o mesmo exemplo de conversa que a home já mostra.
