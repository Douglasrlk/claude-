-- Fieldo · v12.27 · Fase 2 da auditoria SEO/GEO (03/11) · correções de
-- cadastro de perfis específicos (P4, P15, P16). OPCIONAL.
--
-- Diferente do arquivo de estrutura, isto mexe no que cada profissional
-- escreveu. Cada linha só age se o perfil ainda estiver exatamente como
-- estava em 03/11: se a pessoa já arrumou sozinha, nada acontece.
-- Tudo é reversível pela tela de Editar perfil.
--
-- A categoria sugerida é a mesma que o próprio site sugere quando a
-- pessoa abre "Editar perfil" (FIELDO.Profissoes.resolver).
--
--  Perfil (endereço)                                   O que muda
--  ─────────────────────────────────────────────────── ───────────────────────────────
--  empreiteiro-construtor-caraguatatuba-68ou           categoria outro → Empreiteiro
--  construtor-empreiteiro-caraguatatuba-l1r9           categoria outro → Empreiteiro
--  emerson-pedreiro-azulejista-caraguatatuba-r9fj      categoria outro → Pedreiro
--  gabriel-eletricista-caraguatatuba                   sem categoria → Eletricista
--  marcelo-ferreira-eletricista-caraguatatuba          sem categoria → Eletricista
--  anderson-gomes-jardineiro-e-piscineiro-caraguatatuba sem categoria → Jardineiro + Piscineiro
--  locador-aluguel-de-equipamentos-caraguatatuba-b9rm  sem categoria → Locação de equipamentos
--  mathias-rodrigues-pedreiro-proficional-caraguatatuba "Pedreiro proficional" → "Pedreiro profissional"
--  marcio-junior-pintura-proficional-caraguatatuba     "Pintura proficional" → "Pintura profissional"
--  nicanor-ferreira-mineiro-do-google-google-caraguatatuba  profissão "Google", vazio → sai do público
--
-- O endereço (slug) não muda: a profissão nova não gera endereço novo.
-- Estes perfis ganham data de alteração de hoje, e é verdade: mudou o
-- que aparece na página.

begin;

update public.professionals set niche = 'construtor'
 where slug in ('empreiteiro-construtor-caraguatatuba-68ou', 'construtor-empreiteiro-caraguatatuba-l1r9') and niche = 'outro';

update public.professionals set niche = 'alvenaria'
 where slug = 'emerson-pedreiro-azulejista-caraguatatuba-r9fj' and niche = 'outro' and profissao = 'Pedreiro';

update public.professionals set niche = 'eletrica'
 where slug in ('gabriel-eletricista-caraguatatuba', 'marcelo-ferreira-eletricista-caraguatatuba')
   and niche is null and profissao = 'Eletricista';

update public.professionals
   set niche = 'jardineiro',
       outras_profissoes = '[{"rotulo": "Piscineiro", "nicho": "piscineiro"}]'::jsonb
 where slug = 'anderson-gomes-jardineiro-e-piscineiro-caraguatatuba' and niche is null
   and jsonb_array_length(outras_profissoes) = 0;

update public.professionals set niche = 'locacao-de-equipamentos'
 where slug = 'locador-aluguel-de-equipamentos-caraguatatuba-b9rm' and niche is null;

update public.professionals set profissao = 'Pedreiro profissional'
 where slug = 'mathias-rodrigues-pedreiro-proficional-caraguatatuba' and profissao = 'Pedreiro proficional';

update public.professionals set profissao = 'Pintura profissional'
 where slug = 'marcio-junior-pintura-proficional-caraguatatuba' and profissao = 'Pintura proficional';

update public.professionals set is_public = false
 where slug = 'nicanor-ferreira-mineiro-do-google-google-caraguatatuba' and profissao = 'Google'
   and not exists (select 1 from public.reports r where r.professional_id = professionals.id);

commit;

-- conferência: quantos perfis públicos ainda estão sem categoria ou em "outro"
select (select count(*) from public.professionals where is_public and (niche is null or niche = 'outro')) as sem_categoria_util,
       (select string_agg(slug, ', ') from public.professionals where is_public and (niche is null or niche = 'outro')) as quais;
