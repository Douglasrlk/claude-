-- Impressão digital das PERMISSÕES (anon, authenticated, service_role, PUBLIC) em tabelas, funções e colunas.
with sch as (select oid from pg_namespace where nspname in ('public','private','gestao')),
r as (
 select 'T:'||c.relname o, a.grantee, a.privilege_type p from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) a where c.relnamespace in (select oid from sch) and c.relkind in ('r','v')
 union all select 'F:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', a.grantee, a.privilege_type from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a where p.pronamespace in (select oid from sch) and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
 union all select 'C:'||c.relname||'.'||at.attname, a.grantee, a.privilege_type from pg_attribute at join pg_class c on c.oid=at.attrelid, aclexplode(at.attacl) a where c.relnamespace in (select oid from sch) and at.attacl is not null
), x as (select left(o,2) k, o||'>'||case when grantee=0 then 'PUBLIC' else (select rolname from pg_roles where oid=grantee) end||'>'||p s from r where grantee=0 or grantee in (select oid from pg_roles where rolname in ('anon','authenticated','service_role')))
select k, count(*), md5(string_agg(s, '|' order by s)) from x group by k order by k;
