-- Testes do validador do roteiro do Studio (v1 e v2) e de reports.videos.
-- Rodar: docker compose exec -T db psql -U postgres -At -f /dev/stdin < tests/studio_roteiro.sql
-- Cada linha deve sair com "ok".
with f as (select '["https://x/f1.jpg","https://x/f2.jpg"]'::jsonb fotos,
                  '[{"url":"https://x/v1.mp4","duracao":12}]'::jsonb videos),
casos(nome, roteiro, esperado) as (values
 ('v1 continua valido', '{"v":1,"titulo":"Pintura","chamada":"Peça","fotos":["https://x/f1.jpg"],"capa":"https://x/f1.jpg","antes":null,"depois":null,"avaliacao":false}', 'ok'),
 ('v2 completo', '{"v":2,"fotos":["https://x/f1.jpg"],"videos":[{"url":"https://x/v1.mp4","de":1,"ate":9,"vel":1.5,"vol":0.8}],
   "cenas":[{"id":"video:0","texto":"Olha o resultado","trans":"zoom"},{"id":"foto:https://x/f1.jpg","dur":2.5},{"id":"fechamento"}],
   "filtro":"quente","transicao":"deslizar","textoEstilo":"caixa","encerramento":{"estilo":"whatsapp","qr":false,"link":false},
   "musica":{"volume":0.7,"inicio":12.5,"abaixar":true,"nome":"minha musica.mp3"}}', 'ok'),
 ('so video, sem foto', '{"v":2,"fotos":[],"videos":[{"url":"https://x/v1.mp4"}]}', 'ok'),
 ('nada no video', '{"v":2,"fotos":[],"videos":[]}', 'fotos_invalidas'),
 ('video de outro servico', '{"fotos":[],"videos":[{"url":"https://evil/v.mp4"}]}', 'foto_fora_do_servico'),
 ('clipe maior que 30 s', '{"fotos":[],"videos":[{"url":"https://x/v1.mp4","de":0,"ate":31}]}', 'roteiro_invalido'),
 ('corte invertido', '{"fotos":[],"videos":[{"url":"https://x/v1.mp4","de":8,"ate":3}]}', 'roteiro_invalido'),
 ('velocidade fora da lista', '{"fotos":[],"videos":[{"url":"https://x/v1.mp4","vel":7}]}', 'roteiro_invalido'),
 ('texto com html', '{"fotos":["https://x/f1.jpg"],"cenas":[{"id":"abertura","texto":"<script>"}]}', 'texto_invalido'),
 ('cena desconhecida', '{"fotos":["https://x/f1.jpg"],"cenas":[{"id":"drop table"}]}', 'roteiro_invalido'),
 ('chave estranha', '{"fotos":["https://x/f1.jpg"],"html":"x"}', 'roteiro_invalido'),
 ('encerramento invalido', '{"fotos":["https://x/f1.jpg"],"encerramento":{"estilo":"popup"}}', 'roteiro_invalido'),
 ('musica com nome html', '{"fotos":["https://x/f1.jpg"],"musica":{"nome":"<b>x</b>"}}', 'texto_invalido'),
 ('filtro invalido', '{"fotos":["https://x/f1.jpg"],"filtro":"neon"}', 'roteiro_invalido')
)
select case when private.studio_roteiro_valido(c.roteiro::jsonb, f.fotos, f.videos) = c.esperado then 'ok' else 'FALHOU' end
       || '  ' || c.nome || ' → ' || private.studio_roteiro_valido(c.roteiro::jsonb, f.fotos, f.videos)
  from casos c, f
union all
select case when private.report_videos_ok(v::jsonb) = e then 'ok' else 'FALHOU' end || '  reports.videos ' || n
  from (values
    ('valido', '[{"url":"https://x/v.mp4","duracao":29.9,"capa":"https://x/c.jpg","w":1080,"h":1920}]', true),
    ('31 s', '[{"url":"https://x/v.mp4","duracao":31}]', false),
    ('4 videos', '[{"url":"https://a/1","duracao":1},{"url":"https://a/2","duracao":1},{"url":"https://a/3","duracao":1},{"url":"https://a/4","duracao":1}]', false),
    ('url javascript', '[{"url":"javascript:alert(1)","duracao":3}]', false),
    ('url com aspas', '[{"url":"https://x/\"onerror=","duracao":3}]', false)
  ) t(n, v, e);
