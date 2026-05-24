# Checklist de produção

## Variáveis de ambiente obrigatórias

- `VITE_DATA_MODE=firebase`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_RELEASE` (ex.: `2026-02-16.1`)
- `VITE_MONITORING_ENABLED=true` para enviar erros do frontend ao proxy seguro
- `VITE_MONITORING_ENDPOINT` (opcional; se vazio, usa o endpoint configurado no sistema de monitoramento)
- `VITE_PUBLIC_POSTHOG_TOKEN` e `VITE_PUBLIC_POSTHOG_HOST` para analytics de produto

Para funcionalidades legadas que ainda dependem de Supabase Edge Functions:

- `SUPABASE_URL`
- `SERVICE_ROLE_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`)
- `SITE_URL`
- `ALLOWED_ORIGIN` (origem do frontend, ex.: `https://app.example.com`)
- `MONITORING_WEBHOOK_URL` (segredo da Edge Function `frontend-monitoring`, nunca usar com prefixo `VITE_`)
Quando `VITE_STORAGE_PROVIDER=microsoft_drive`, configure também:

- `MS_AUTH_MODE` (`app` ou `delegated`)
- `MS_TENANT_ID`
- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`
- `MS_DRIVE_ID` (obrigatório no modo `app`, opcional em `delegated`)
- `MS_DRIVE_BASE_PATH` (opcional, padrão: `orthoscan`)
- `MS_DRIVE_LINK_SCOPE` (opcional, `anonymous` ou `organization`)
- `MS_AUTHORITY` (somente `delegated`, geralmente `consumers` para contas pessoais)
- `MS_REFRESH_TOKEN` (somente `delegated`)

Para o `whatsapp-service` online:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_TOKEN`
- `ALLOWED_ORIGIN` (ex.: `https://www.orthoscan.online`)
- `AUTH_DATA_PATH=/data/.wwebjs_auth`
- volume persistente montado em `/data`

## Headers de segurança

- Os headers da Vercel são aplicados em `vercel.json`.
- Os headers do Nginx são aplicados em `nginx.conf` e `nginx.edge.template.conf`.

## Porta de CI

- Workflow: `.github/workflows/ci.yml`
- Verificações obrigatórias:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test -- --run`
  - `npm run build`

## Storage e arquivos

- Bucket: `orthoscan` (privado)
- Todos os envios devem passar por `src/repo/storageRepo.ts`.
- Use URLs assinadas para acesso de leitura.

## Smoke checks pós-deploy

1. Login e acesso baseado em perfis.
2. Enviar PDF/JPEG/STL e reabrir arquivos.
3. Redefinição de senha e fluxo de link de onboarding.
4. Verificar endpoint `/health` e monitor de uptime.
5. Confirmar no PostHog os eventos `orthoscan_posthog_linked`, `auth.sign_in_succeeded` e um evento de negocio (`case.created` ou `lab.sent`).
6. Confirmar que erros do frontend chegam via Edge Function `frontend-monitoring`.

