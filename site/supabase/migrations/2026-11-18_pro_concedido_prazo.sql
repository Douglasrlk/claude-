-- Fieldo · v12.40 · prazo para o Pro concedido à mão (18/11/2026)
--
-- Dois profissionais estavam com plan = 'pro' e plan_expires_at nulo
-- (Pro para sempre): um concedido à mão, sem licença nem assinatura; outro
-- com a assinatura Asaas cancelada em 13/11. O dono confirmou que foi
-- intencional e decidiu: 30 dias + 5 dias de acréscimo, com aviso do
-- sistema nos últimos 5 dias (job plano_ciclo_diario); depois, grátis.
--
-- Só toca quem está Pro SEM prazo. Quem tem prazo (assinatura/licença)
-- segue o próprio prazo.

update public.professionals
   set plan_expires_at = now() + interval '35 days'
 where plan = 'pro'
   and plan_expires_at is null
   and id in ('d58edadf-d451-4694-bb9f-4b313e588231',   -- mathias-rodrigues-pedreiro…
              '3d129e17-91fa-41ec-be39-2c3708615b8e');  -- marcelo-ferreira-rodrigues-eletricista…
