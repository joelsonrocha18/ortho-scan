# Relatorio de Mapeamento do Sistema OrthoScan

Data do mapeamento: 2026-05-15

## 1. Resumo executivo

O OrthoScan e um sistema web para gestao clinica e laboratorial em ortodontia digital. A aplicacao cobre cadastro de pacientes, dentistas e clinicas, recebimento de escaneamentos, criacao e acompanhamento de casos de alinhadores, pipeline de laboratorio, portal de acesso publico para pacientes/dentistas, documentos, notificacoes, diagnosticos e configuracoes administrativas.

O sistema esta implementado principalmente como SPA React + TypeScript + Vite, com suporte a PWA, execucao local/offline com persistencia no navegador, modo multiusuario com Firebase, rotas protegidas por RBAC, testes unitarios e E2E, deploy via Vercel/Docker/Nginx e empacotamento desktop via Electron.

## 2. Metricas do reposititorio

| Area | Quantidade |
| --- | ---: |
| Arquivos fonte em `src` (`.ts`, `.tsx`, `.js`) | 358 |
| Linhas de codigo em `src` | 43.784 |
| Migrations Supabase | 26 |
| Edge Functions Supabase | 15 |
| Testes automatizados unitarios/componentes/E2E | 32 |

Observacao: `node_modules` e `dist` foram ignorados no mapeamento estrutural.

## 3. Stack principal

| Camada | Tecnologias |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 7, React Router 7 |
| UI | Tailwind CSS, lucide-react, componentes proprios |
| Estado/persistencia local | SQL.js/localStorage e repositorios locais |
| Backend remoto | Firebase Auth, Firestore, RLS-like rules, Storage, Edge Functions legacy |
| PWA | vite-plugin-pwa com service worker customizado |
| Testes | Vitest, Testing Library, Playwright |
| Desktop | Electron + electron-builder |
| Deploy | Vercel, Docker, Nginx, docker-compose |
| Qualidade | ESLint, TypeScript typecheck, GitHub Actions |

## 4. Estrutura de alto nivel

```text
.
|-- src/                  Aplicacao React, dominio, modulos, repositorios e testes
|-- src/modules/          Contextos de negocio com presentation/application/domain/infra
|-- src/pages/            Paginas roteadas da SPA
|-- src/components/       Componentes compartilhados
|-- src/repo/             Repositorios remotos/Supabase e integracoes
|-- src/data/             Persistencia local, seed, sync e repositorios locais legados
|-- src/auth/             Autenticacao, sessao, escopo e permissoes
|-- src/pwa/              Service worker, push e inscricoes
|-- src/diagnostics/      Diagnosticos e dados de teste
|-- supabase/             Migrations, seed, config e Edge Functions
|-- e2e/                  Testes Playwright
|-- desktop/              Entrada Electron e build desktop
|-- docs/                 Documentacao operacional e SQL auxiliar
|-- scripts/              QA, diagnosticos, preflight e deploy blue/green
|-- public/               Assets de marca, PWA e audio de notificacao
```

## 5. Arquitetura da aplicacao

O projeto segue uma combinacao de arquitetura modular por contexto de negocio e camadas compartilhadas.

### 5.1 Entrada e roteamento

- Entrada principal: `src/main.tsx`.
- Composicao da SPA: `src/App.tsx`.
- Rotas conhecidas: `src/routes/appRoutes.ts`.
- Rotas publicas: login, acesso publico, portal de pacientes, portal de dentistas, paginas legais, onboarding e reset de senha.
- Rotas internas: dashboard, escaneamentos, casos, portal do dentista, dentistas, clinicas, pacientes, laboratorio, ajuda, configuracoes, diagnosticos e migracao.
- Rotas internas usam `ProtectedRoute` com permissoes por area.
- O app usa `BrowserRouter` em HTTP/HTTPS e `HashRouter` quando aberto via `file:`, o que ajuda no pacote desktop.

### 5.2 Modulos de dominio

O diretorio `src/modules` formaliza contextos com quatro camadas:

- `presentation`: containers, hooks, secoes, modais e componentes de UI do modulo.
- `application`: casos de uso e portas de repositorio.
- `domain`: entidades, value objects, servicos de dominio e eventos.
- `infra`: adaptadores locais e Supabase.

Modulos principais:

| Modulo | Responsabilidade |
| --- | --- |
| `dashboard` | KPIs executivos, backlog, SLA e visao gerencial |
| `cases` | Criacao, ciclo de vida, timeline, anexos, versoes de planejamento e financeiros de casos |
| `lab` | Fila laboratorial, etapas, SLA, checklist, expedicao e reconfeccoes |
| `publicAccess` | Acesso publico para pacientes, magic link, portal, fotos e documentos |
| `dentistPortal` | Visao externa do dentista com casos, documentos e aprovacoes |
| `notifications` | Painel de notificacoes estrategicas |

## 6. Principais fluxos funcionais

### 6.1 Autenticacao e acesso

- O modo de dados e definido por `VITE_DATA_MODE`.
- Valor padrao: `firebase`.
- Em modo `firebase`, autentica via Firebase Auth.
- Em modo `local`, usa provedor local.
- A camada `authProvider` escolhe dinamicamente entre `authFirebase` e `authLocal`.
- A autorizacao usa permissoes declarativas em `src/auth/permissions.ts`.

Perfis mapeados:

| Perfil | Papel esperado |
| --- | --- |
| `master_admin` | Administracao total |
| `dentist_admin` | Administracao operacional da clinica |
| `dentist_client` | Acesso externo de dentista |
| `clinic_client` | Acesso externo de clinica |
| `lab_tech` | Operacao de laboratorio |
| `receptionist` | Cadastro e atendimento |

### 6.2 Escaneamentos e casos

- Escaneamentos entram pelo modulo/pagina de scans.
- Casos podem ser criados a partir de scans.
- O modulo `cases` controla status, fase, SLA, timeline, anexos, arquivos de scan, versoes de planejamento, bandejas e financeiro.
- Eventos de dominio documentados: `CaseApproved`, `CaseCreated`, `LabStarted`, `LabShipped` e `CaseDelivered`.

### 6.3 Laboratorio

- O modulo `lab` acompanha ordens laboratoriais.
- Etapas principais: `queued`, `in_production`, `qc`, `shipped`, `delivered`, `rework`.
- Servicos de dominio calculam SLA, prioridade, fila de producao, checklist e impacto financeiro de reconfeccoes.

### 6.4 Portais externos

- Pacientes acessam area publica por token/magic link.
- O portal do paciente inclui resumo, cronograma, timeline, envio de fotos, documentos e calendario.
- Dentistas possuem area externa para acompanhar casos, documentos e aprovacoes.

### 6.5 Documentos e armazenamento

- O sistema possui documentos associados a entidades e casos.
- Storage remoto e configuravel via Supabase Storage ou Microsoft Drive/OneDrive.
- Ha Edge Function `ms-drive-storage` para integracao Microsoft Drive.

### 6.6 Notificacoes e PWA

- O app possui manifest PWA, assets dedicados e service worker.
- Push web e controlado por `VITE_WEB_PUSH_ENABLED`.
- Tabela/funcao de inscricoes push aparece nas migrations e em `src/pwa`.

## 7. Dados e persistencia

### 7.1 Modo local

O modo local usa dados no navegador e repositorios locais. Ele e util para demo, operacao isolada ou migracao inicial. O arquivo `src/data/db.ts` centraliza o modelo local e seeds.

Entidades locais principais:

- `cases`
- `labItems`
- `replacementBank`
- `patients`
- `patientDocuments`
- `scans`
- `dentists`
- `clinics`
- `users`
- `auditLogs`

### 7.2 Modo Firebase

O modo Firebase usa:

- Firebase Auth para sessao.
- Firestore para dados relacionais e documentos.
- Regras de segurança para isolamento por perfil/escopo.
- Storage para arquivos.
- Edge Functions legado para operacoes privilegiadas e integracoes.

Tabelas e areas identificadas nas migrations:

- Clinicas, dentistas, perfis, pacientes, scans, cases, lab_items, documents.
- Entregas, roles/permissoes, profile_permissions.
- Auditoria de seguranca e tokens de reset.
- Convites/onboarding.
- Chat interno, salas, leituras e presenca.
- Configuracoes da aplicacao.
- Feature flags e jobs de IA.
- Tokens de acesso de paciente.
- Inscricoes push.

## 8. Supabase Edge Functions

Foram identificadas 15 Edge Functions:

| Function | Finalidade provavel |
| --- | --- |
| `invite-user` | Convite de usuario |
| `create-onboarding-invite` | Criacao de convite por link |
| `validate-onboarding-invite` | Validacao de convite |
| `complete-onboarding-invite` | Conclusao do onboarding |
| `request-password-reset` | Solicitacao de reset |
| `complete-password-reset` | Conclusao de reset |
| `send-access-email` | Envio de link/acesso por e-mail |
| `patient-request-magic-link` | Magic link de paciente |
| `patient-access-session` | Sessao de acesso do paciente |
| `patient-access-lookup` | Consulta de acesso de paciente |
| `patient-upload-progress-photo` | Upload de foto de progresso |
| `send-web-push` | Envio de notificacao push |
| `ms-drive-storage` | Integracao Microsoft Drive |
| `import-db` | Importacao de banco local/remoto |
| `export-db` | Exportacao de banco |

## 9. Seguranca

Pontos positivos identificados:

- Rotas internas protegidas por permissao.
- RBAC centralizado por perfil.
- Sessao Supabase em storage customizado de sessao.
- Limpeza de storage legado de autenticacao.
- RLS habilitado nas tabelas principais.
- Funcoes Postgres auxiliares para papel, clinica atual e administracao.
- Auditoria de seguranca e reset de senha em migrations.
- Separacao entre anon key no frontend e service role em Edge Functions.

Pontos de atencao:

- O README principal ainda parece derivado do template Vite e nao descreve o produto real.
- E importante revisar periodicamente as policies RLS, principalmente para perfis externos e acesso por paciente.
- As funcoes Edge dependem de variaveis sensiveis; o controle operacional dessas variaveis precisa estar documentado por ambiente.
- Existe modo local com senha padrao/demo; confirmar que nunca e usado como credencial real em producao.

## 10. Qualidade, testes e CI

Scripts principais:

| Script | Objetivo |
| --- | --- |
| `npm run dev` | Servidor Vite local |
| `npm run build` | TypeScript build + Vite build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Typecheck sem emit |
| `npm run test` | Vitest |
| `npm run test:e2e` | Playwright |
| `npm run qa:diagnostics` | Diagnosticos CLI |
| `npm run qa` | Diagnosticos, testes, E2E, build e relatorio |

O CI em `.github/workflows/ci.yml` roda:

1. `npm ci`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test -- --run`
5. `npm run build`

Os testes cobrem banco/migracao local, RBAC, PWA, fluxos de negocio, modulos `lab` e `cases`, acesso publico, utilitarios, autenticacao e componentes.

## 11. Deploy e ambientes

### 11.1 Vercel

- `vercel.json` faz fallback SPA para `index.html`.
- Build esperado: `npm run build`.
- Saida: `dist`.

### 11.2 Docker/Nginx

- Ha `Dockerfile`, `docker-compose.yml`, `nginx.conf` e configuracoes blue/green.
- Ha scripts PowerShell para deploy/switch/rollback blue-green.

### 11.3 Desktop

- `desktop/main.cjs` e `desktop/preload.cjs` suportam pacote Electron.
- `package.json` configura `electron-builder` para Windows/NSIS.
- O build desktop usa `ELECTRON_BUILD=1`, com base relativa no Vite.

## 12. Variaveis de ambiente relevantes

Frontend:

- `VITE_DATA_MODE=local|firebase`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_STORAGE_PROVIDER=supabase|microsoft_drive`
- `VITE_WEB_PUSH_ENABLED=true|false`
- `VITE_FORCE_HTTPS=1`

Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SITE_URL`
- `ALLOWED_ORIGIN`
- `INVITE_REDIRECT_URL`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `MS_TENANT_ID`
- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`
- `MS_DRIVE_ID`
- `MS_DRIVE_BASE_PATH`
- `MS_DRIVE_LINK_SCOPE`
- `MS_AUTH_MODE`
- `MS_AUTHORITY`
- `MS_REFRESH_TOKEN`

## 13. Estado atual do workspace

Antes da geracao deste relatorio, o reposititorio ja continha alteracoes nao commitadas:

- `package-lock.json` modificado.
- `docs/SUPABASE_VERCEL_MIGRATION.md` novo.

Este relatorio foi criado como arquivo novo em `docs/RELATORIO_MAPEAMENTO_SISTEMA.md`.

## 14. Riscos e recomendacoes

| Prioridade | Item | Recomendacao |
| --- | --- | --- |
| Alta | README generico | Substituir o README de template por documentacao real do OrthoScan: objetivo, setup, ambientes, usuarios e deploy |
| Alta | RLS e acesso externo | Auditar policies de pacientes/dentistas e tokens publicos com testes especificos por perfil |
| Alta | Variaveis de Edge Functions | Criar matriz por ambiente com variaveis obrigatorias, dono e metodo de rotacao |
| Media | Documentacao de dominio | Expandir documentacao dos modulos `dashboard`, `publicAccess` e `dentistPortal` no mesmo padrao de `cases` e `lab` |
| Media | Observabilidade | Formalizar eventos, logs, auditoria e estrategia de monitoramento em producao |
| Media | CI E2E | Considerar job separado para Playwright em PRs criticos ou nightly, pois o CI atual nao roda E2E |
| Baixa | Inventario de assets | Documentar assets de marca e PWA em `public/brand` para evitar substituicoes acidentais |

## 15. Proximos passos sugeridos

1. Atualizar o README principal para refletir o produto real.
2. Rodar `npm run lint`, `npm run typecheck`, `npm run test -- --run` e `npm run build` antes de publicar.
3. Validar Supabase local/remoto com `supabase db push` em ambiente de homologacao.
4. Revisar Edge Functions que usam service role.
5. Criar um diagrama simples de arquitetura e fluxo de dados para onboarding de novos desenvolvedores.
6. Documentar perfis, permissoes e escopos de acesso em linguagem operacional.

## 16. Conclusao

O OrthoScan ja possui uma base tecnica madura para um sistema operacional clinico/laboratorial: modularizacao por dominio, RBAC, Supabase com RLS, PWA, testes, CI, deploy web e pacote desktop. O principal ganho imediato esta menos em reescrever codigo e mais em consolidar documentacao operacional, endurecer revisoes de seguranca dos acessos externos e alinhar README/ambientes ao estado real do produto.
