-- Fieldo · dados de DEMONSTRAÇÃO para o ambiente local.
-- Tudo aqui é fictício. Nenhuma linha vem de produção (produção tem dado
-- pessoal de clientes: nome, telefone, IP, assinatura — LGPD).
--
-- Contas criadas (entre pelo e-mail + senha "fieldo-demo-123"):
--   ana.pintora@demo.local     profissional (pintora, Caraguatatuba)
--   bruno.eletricista@demo.local profissional (eletricista, Ubatuba)
--   locadora@demo.local        locadora de equipamentos (2 equipamentos, preço por período)

begin;

-- Os campos de token vão como '' (não NULL): o GoTrue falha com
-- "Database error querying schema" ao ler NULL neles.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        email_change_token_current, reauthentication_token, phone_change, phone_change_token)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
   'ana.pintora@demo.local', extensions.crypt('fieldo-demo-123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
   'bruno.eletricista@demo.local', extensions.crypt('fieldo-demo-123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
   'locadora@demo.local', extensions.crypt('fieldo-demo-123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '');

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
  from auth.users u where u.email like '%@demo.local';

insert into public.professionals (id, name, profissao, city, whatsapp, bio, niche, is_public, portfolio_publico, plan)
values
  ('11111111-1111-4111-8111-111111111111', 'Ana Demonstração', 'Pintora', 'Caraguatatuba', '12900000001',
   'Pintura residencial e comercial, textura e grafiato. Perfil fictício do ambiente local.', 'pintor', true, true, 'free'),
  ('22222222-2222-4222-8222-222222222222', 'Bruno Exemplo', 'Eletricista', 'Ubatuba', '12900000002',
   'Instalações, quadros de distribuição e manutenção. Perfil fictício do ambiente local.', 'eletricista', true, true, 'free');

insert into public.reports (id, professional_id, client_name, category_key, category_label, niche, service_date,
                            service_location, service_description, photos, is_public, portfolio_ok, tipo)
values
  ('aaaaaaa1-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Cliente Fictício Um',
   'pintura', 'Pintura', 'pintor', current_date - 20, 'Centro', 'Pintura completa de sala e cozinha com massa corrida.',
   '[]'::jsonb, true, true, 'servico'),
  ('aaaaaaa1-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Cliente Fictício Dois',
   'pintura', 'Pintura', 'pintor', current_date - 7, 'Martim de Sá', 'Textura externa em muro de 30 m².',
   '[]'::jsonb, true, true, 'servico'),
  ('aaaaaaa1-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'Cliente Fictício Três',
   'eletrica', 'Elétrica', 'eletricista', current_date - 3, 'Itaguá', 'Troca de quadro de distribuição e disjuntores.',
   '[]'::jsonb, true, true, 'servico');

-- avaliação pelo caminho oficial (a mesma função que o link do cliente chama)
select public.submit_rating(r.rating_token, 5::smallint, 'Serviço caprichado, recomendo. (demo)', 'Cliente Fictício')
  from public.reports r where r.id = 'aaaaaaa1-0000-4000-8000-000000000001';

insert into public.locadoras (id, nome, city, uf, whatsapp, bio, responsavel)
values ('33333333-3333-4333-8333-333333333333', 'Locadora Demonstração', 'Caraguatatuba', 'SP', '12900000003',
        'Andaimes, betoneiras e ferramentas. Locadora fictícia do ambiente local.', 'Responsável Demo');

-- aceite dos Termos e da Política (versão de dados-legais.js): sem ele o
-- painel abre travado no modal de aceite
insert into public.aceites (user_id, documento, versao, aceito, origem)
select u.id, d, '2026-11-11', true, 'seed-demo'
  from auth.users u, unnest(array['termos', 'privacidade']) d
 where u.email like '%@demo.local';

-- equipamentos com preço por período (v12.42): um com todos, um só mensal
insert into public.equipamentos (locadora_id, categoria_id, nome, marca, descricao, preco_dia, preco_semana,
                                 preco_quinzena, preco_mes, caucao, quantidade, is_public, ativo, specs)
select '33333333-3333-4333-8333-333333333333', c.id, x.nome, x.marca, x.descricao, x.dia, x.sem, x.quin, x.mes, x.cau, x.qtd, true, true,
       '{"condicoes":"Retirada com documento. (demo)"}'::jsonb
  from (select id from public.equipamento_categorias order by ordem limit 1) c,
       (values ('Betoneira 400 litros (demo)', 'Menegotti', 'Equipamento fictício.', 80, 400, 700, 1200, 300, 2),
               ('Container escritório 6 m (demo)', null, 'Aluguel mínimo de uma quinzena. Equipamento fictício.', null, null, 900, 1500, 0, 1))
       as x(nome, marca, descricao, dia, sem, quin, mes, cau, qtd);

commit;
