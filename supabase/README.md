# Supabase Setup (OrthoScan)

## 1) Criar projeto no Supabase
- Crie um novo projeto no dashboard.
- Anote `Project URL` e `Anon public key`.

## 2) Auth (e-mail/senha)
- Habilite o provedor de e-mail.
- Configure URLs de redirect:
  - `SITE_URL` (ex.: https://seu-dominio.com)
  - Redirects: `https://seu-dominio.com/**`

## 3) Aplicar migrations
Opção A (SQL Editor):
- Copie e cole `supabase/migrations/0001_init.sql`
- Depois aplique `supabase/migrations/0003_storage.sql`

Opção B (CLI Supabase):
- `supabase db push`

## 4) Edge Function (convite)
Configure variáveis da function:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SITE_URL`
- `INVITE_REDIRECT_URL` (ex.: https://seu-dominio.com/login)
- `ALLOWED_ORIGIN` (ex.: https://seu-dominio.com)

Deploy:
- `supabase functions deploy invite-user`

## 4.3) Edge Functions (onboarding por link)
Configure variaveis:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SITE_URL` (ex.: https://seu-dominio.com)
- `ALLOWED_ORIGIN` (ex.: https://seu-dominio.com)

Deploy:
- `supabase functions deploy create-onboarding-invite`
- `supabase functions deploy validate-onboarding-invite`
- `supabase functions deploy complete-onboarding-invite`

## 4.1) Edge Function (import/export)
Configure variáveis:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Deploy:
- `supabase functions deploy import-db`
- `supabase functions deploy export-db`

## 4.2) Edge Functions (acesso e reset por token)
Configure variaveis:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SITE_URL` (ex.: https://seu-dominio.com)
- `RESEND_API_KEY`
- `EMAIL_FROM` (ex.: no-reply@seu-dominio.com)

Deploy:
- `supabase functions deploy send-access-email`
- `supabase functions deploy request-password-reset`
- `supabase functions deploy complete-password-reset`

## 4.4) Edge Function (Microsoft Drive / OneDrive)
Configure variaveis:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SITE_URL`
- `ALLOWED_ORIGIN`
- `MS_AUTH_MODE` (`app` ou `delegated`)
- `MS_TENANT_ID`
- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`
- `MS_DRIVE_ID` (obrigatório em `app`; opcional em `delegated`)
- `MS_DRIVE_BASE_PATH` (opcional, ex.: `orthoscan`)
- `MS_DRIVE_LINK_SCOPE` (opcional: `anonymous` ou `organization`)
- `MS_AUTHORITY` (somente `delegated`, ex.: `consumers`)
- `MS_REFRESH_TOKEN` (somente `delegated`)

Deploy:
- `supabase functions deploy ms-drive-storage`

## 4.5) WhatsApp Service
O QR Code e o envio direto de WhatsApp ficam no microservico `whatsapp-service/`, nao em Supabase Edge Function.
Veja `whatsapp-service/README.md` para configurar `ADMIN_TOKEN`, `ALLOWED_ORIGIN`, Docker e volume persistente.

## 5) Frontend
Crie um `.env` baseado em `.env.example`:
```
VITE_DATA_MODE=supabase
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_STORAGE_PROVIDER=supabase
```

Para usar Microsoft Drive no frontend:
```
VITE_STORAGE_PROVIDER=microsoft_drive
```

## 6) Perfil inicial (master)
Depois de criar o usuário no Auth, crie um profile:
```
insert into profiles (user_id, role, clinic_id, full_name, is_active)
values ('<auth_user_id>', 'master_admin', '<clinic_id>', 'Administrador master', true);
```

## 7) Seed inicial
Execute `supabase/seed/seed.sql` no SQL Editor e siga as instrucoes comentadas.

## 8) Migração
Use `/app/settings/migration` (somente master_admin) para exportar o DB local e importar no Supabase.

## Nota: perfis (profiles) no modo Supabase
- O app lista e aplica RBAC usando `profiles`.
- O reset de senha busca o usuário por `profiles.login_email` (preenchido automaticamente no onboarding/invite).
