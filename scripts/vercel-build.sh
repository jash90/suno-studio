#!/bin/sh
# Build na Vercelu. Z CONVEX_DEPLOY_KEY (Production key z dashboardu Convex) najpierw
# wdraża funkcje Convex, potem buduje frontend z URL-em tego deploymentu — frontend
# i backend nie rozjadą się już przy pushu. Bez klucza: sam frontend (jak dotąd,
# funkcje Convex wdraża się ręcznie `npx convex deploy`).
set -e
if [ -n "$CONVEX_DEPLOY_KEY" ]; then
  npx convex deploy --cmd "npx nx build web" --cmd-url-env-var-name VITE_CONVEX_URL
else
  echo "CONVEX_DEPLOY_KEY nie ustawiony — buduję tylko frontend (Convex bez zmian)"
  npx nx build web
fi
