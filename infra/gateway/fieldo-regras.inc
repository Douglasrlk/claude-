# Regras do netlify.toml traduzidas para nginx (redirects + headers).
# Incluído pelos servidores 8080 e 8081.

include /etc/nginx/conf.d/fieldo-seguranca.inc;

# arquivos que a Netlify devolve como 404 (status 404, force = true)
location ~ ^/(codes\.html|admin\.html|vercel\.json|_guia_conectar\.html|netlify\.toml)$ { return 404; }
location ~ ^/(_verify|netlify|services|supabase)/ { return 404; }

location = /comece.html { return 301 /; }

# /p/:slug → perfil.html?slug=:slug&_i=1 (status 200 = reescrita, não redirect)
# /.well-known/assetlinks.json → well-known/ (sem ponto; regra do netlify.toml v12.45)
location = /.well-known/assetlinks.json { default_type application/json; alias /site/well-known/assetlinks.json; }
location ~ ^/p/(.+)$ { rewrite ^/p/(.+)$ /perfil.html?slug=$1&_i=1 last; }

location ~* \.mjs$ { types { text/javascript mjs; } add_header Cache-Control "public, max-age=604800"; include /etc/nginx/conf.d/fieldo-seguranca.inc; }
location ~* \.html$ { add_header Cache-Control "no-cache, must-revalidate"; include /etc/nginx/conf.d/fieldo-seguranca.inc; try_files $uri =404; }

# "Pretty URLs" da Netlify: /explorar → explorar.html
location / {
  try_files $uri $uri.html $uri/ =404;
}
