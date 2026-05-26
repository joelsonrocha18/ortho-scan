# Checklist de producao

## Variaveis obrigatorias

- `VITE_DATA_MODE=firebase`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID=gostosao-3421e`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_RELEASE`
- `VITE_APP_URL=https://www.orthoscan.online`
- `VITE_MONITORING_ENABLED`
- `VITE_MONITORING_ENDPOINT`, se houver coletor externo
- `VITE_PUBLIC_POSTHOG_TOKEN` e `VITE_PUBLIC_POSTHOG_HOST`, se analytics estiver ativo

## WhatsApp service

- `FIREBASE_PROJECT_ID=gostosao-3421e`
- `FIREBASE_SERVICE_ACCOUNT_JSON` ou `GOOGLE_APPLICATION_CREDENTIALS`
- `ADMIN_TOKEN`
- `ALLOWED_ORIGIN=https://www.orthoscan.online`
- `AUTH_DATA_PATH=/data/.wwebjs_auth`
- volume persistente montado em `/data`

## Validacao antes do deploy

- `npm run typecheck`
- `npm run build`
- `npm run qa:diagnostics`

## Smoke checks pos-deploy

1. Login e acesso baseado em perfis.
2. Enviar PDF/JPEG/STL e reabrir arquivos.
3. Redefinicao de senha.
4. Criar/editar pacientes, dentistas, clinicas, exames e casos.
5. Conferir agenda, laboratorio, estoque e contratos com usuario sem permissao total.
6. Confirmar eventos de analytics, caso habilitados.
