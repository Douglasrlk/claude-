# Headers de segurança do netlify.toml ([[headers]] for = "/*").
# Incluído em todo bloco que tem add_header próprio (no nginx, um add_header
# dentro de location anula os herdados do server).
add_header X-Frame-Options        "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy        "strict-origin-when-cross-origin" always;
add_header Permissions-Policy     "geolocation=(self), camera=(self), microphone=()" always;
