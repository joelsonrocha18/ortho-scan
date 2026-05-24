# Migração Supabase + Vercel

> Nota: este documento descreve o fluxo legado de implantação com Supabase. A versão atual do projeto usa Firebase como modo remoto principal, então este material deve ser usado apenas como referência histórica ou para migração de funcionalidades legadas.

Runbook para conectar o OrthoScan ao Supabase e publicar na Vercel.

## Pré-requisitos

- Acesso ao projeto Supabase de produção.
- Acesso ao projeto/time na Vercel.
- `Project URL`, `anon public key` e `service role key` do Supabase.
- Domínio final da aplicação, por exemplo `https://ortho-scan.vercel.app`.

## 1. Autenticar CLIs

```bash
npx vercel login
npx supabase login
```

Alternativa para CI/ambiente remoto:

```bash
export SUPABASE_ACCESS_TOKEN=...
export VERCEL_TOKEN=...
```

## 2. Linkar projetos

```bash
npx vercel link
npx supabase link --project-ref <supabase_project_ref>
```

O `project-ref` é o identificador no host do Supabase, como `abcdefghijklmno`, não a URL completa.

## 3. Configurar variáveis na Vercel

Frontend:

```text
VITE_DATA_MODE=supabase
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_public_key>
VITE_STORAGE_PROVIDER=supabase
VITE_APP_URL=https://<dominio-final>
VITE_WEB_PUSH_ENABLED=false
VITE_INTERNAL_CHAT_ENABLED=false
VITE_MONITORING_ENABLED=true
VITE_MONITORING_ENDPOINT=
VITE_RELEASE=<versao-ou-data>
VITE_PUBLIC_POSTHOG_TOKEN=<posthog_project_api_key>
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Com Vercel CLI:

```bash
npx vercel env add VITE_DATA_MODE production
npx vercel env add VITE_SUPABASE_URL production
npx vercel env add VITE_SUPABASE_ANON_KEY production
npx vercel env add VITE_STORAGE_PROVIDER production
npx vercel env add VITE_APP_URL production
npx vercel env add VITE_MONITORING_ENABLED production
npx vercel env add VITE_PUBLIC_POSTHOG_TOKEN production
npx vercel env add VITE_PUBLIC_POSTHOG_HOST production
```

Repita para `preview` se o ambiente de homologacao tambem precisar apontar para Supabase.

Para o proxy seguro de erros, configure o segredo da Edge Function no Supabase:

```bash
npx supabase secrets set MONITORING_WEBHOOK_URL=<webhook_privado>
```

## 4. Configurar Supabase Auth

No painel Supabase:

- Site URL: `https://<dominio-final>`
- Redirect URLs:
  - `https://<dominio-final>/**`
  - URLs de preview da Vercel, se usadas para teste
- Email provider habilitado.

## 5. Aplicar migrations e seed

```bash
npm run migrate
```

Seed inicial, se o banco estiver vazio:

```bash
npx supabase db reset --linked
```

Use `db reset --linked` somente quando for intencional recriar dados no projeto linkado. Para producao com dados existentes, prefira aplicar apenas migrations e executar inserts pontuais do `supabase/seed/seed.sql`.

## 6. Configurar secrets das Edge Functions

Secrets obrigatorios para a maioria das functions:

```bash
npx supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
npx supabase secrets set SITE_URL=https://<dominio-final>
npx supabase secrets set ALLOWED_ORIGIN=https://<dominio-final>
```

Para envio de e-mail:

```bash
npx supabase secrets set RESEND_API_KEY=<resend_api_key>
npx supabase secrets set EMAIL_FROM=no-reply@<dominio>
```

Para Microsoft Drive, somente se `VITE_STORAGE_PROVIDER=microsoft_drive`:

```bash
npx supabase secrets set MS_AUTH_MODE=app
npx supabase secrets set MS_TENANT_ID=<tenant_id>
npx supabase secrets set MS_CLIENT_ID=<client_id>
npx supabase secrets set MS_CLIENT_SECRET=<client_secret>
npx supabase secrets set MS_DRIVE_ID=<drive_id>
npx supabase secrets set MS_DRIVE_BASE_PATH=orthoscan
npx supabase secrets set MS_DRIVE_LINK_SCOPE=anonymous
```

## 7. Deploy das Edge Functions

```bash
npx supabase functions deploy invite-user
npx supabase functions deploy create-onboarding-invite
npx supabase functions deploy validate-onboarding-invite
npx supabase functions deploy complete-onboarding-invite
npx supabase functions deploy import-db
npx supabase functions deploy export-db
npx supabase functions deploy send-access-email
npx supabase functions deploy request-password-reset
npx supabase functions deploy complete-password-reset
npx supabase functions deploy patient-access-lookup
npx supabase functions deploy patient-access-session
npx supabase functions deploy patient-request-magic-link
npx supabase functions deploy patient-upload-progress-photo
npx supabase functions deploy send-web-push
npx supabase functions deploy frontend-monitoring
npx supabase functions deploy ms-drive-storage
```

Para publicar somente o monitoramento:

```bash
npm run deploy:monitoring
```

Esse atalho usa o `project-ref` de `.env.production`, então não depende de `supabase link`.

## 8. Deploy Vercel

```bash
npm run preflight:prod
npm run build
npx vercel deploy --prod
```

Atalho:

```bash
npm run deploy:prod
```

## 9. Conferencias pos-deploy

- Login de master/admin.
- Criacao ou convite de usuario.
- Cadastro de clinica, paciente e caso.
- Upload/download de arquivos.
- Portal publico de paciente.
- Reset de senha.
- `/app/settings/migration`, se ainda houver dados locais a importar.
