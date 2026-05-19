# OrthoScan WhatsApp Service

Microsservico Node.js online para enviar lembretes diarios de troca de alinhadores via `whatsapp-web.js`.

## Rodar localmente para teste

1. Entre na pasta do servico:
   ```bash
   cd whatsapp-service
   ```

2. Instale as dependencias:
   ```bash
   npm install
   ```

3. Crie o `.env` a partir do exemplo:
   ```bash
   cp .env.example .env
   ```

4. Preencha:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CRON_TIME`, se quiser mudar o horario. O padrao `0 8 * * *` roda todos os dias as 08:00.

5. Inicie:
   ```bash
   npm start
   ```

Na primeira execucao, leia o QR Code exibido no terminal pelo WhatsApp da clinica. A sessao fica salva localmente em `whatsapp-service/.wwebjs_auth`, usando `LocalAuth`, entao normalmente nao sera necessario ler o QR Code a cada reinicio.

## Rodar online

Use VPS, Railway, Render, Fly.io ou outro host que rode processo 24/7 com Docker e volume persistente. Serverless puro, como Vercel Functions, nao e adequado porque o WhatsApp Web precisa manter navegador, websocket e sessao viva.

Configure estas variaveis no ambiente online:

```env
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
CRON_TIME=0 8 * * *
TZ=America/Sao_Paulo
RUN_ON_START=false
PUPPETEER_HEADLESS=true
PORT=3000
ADMIN_TOKEN=um-token-grande-e-secreto
ALLOWED_ORIGIN=https://www.orthoscan.online
AUTH_DATA_PATH=/data/.wwebjs_auth
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

O volume persistente deve montar `/data`. Sem esse volume, a sessao do WhatsApp sera perdida em cada redeploy/restart.

Depois do deploy, acesse:

- `https://seu-dominio/health` para health check publico.
- `https://seu-dominio/status?token=SEU_ADMIN_TOKEN` para status protegido.
- `https://seu-dominio/qr?token=SEU_ADMIN_TOKEN` para ler o QR Code online.
- `POST https://seu-dominio/send` com header `Authorization: Bearer SEU_ADMIN_TOKEN` para envio direto pelo OrthoScan.

Para disparar manualmente a rotina:

```bash
curl -X POST "https://seu-dominio/run-now?token=SEU_ADMIN_TOKEN"
```

Envio manual:

```bash
curl -X POST "https://seu-dominio/send" \
  -H "Authorization: Bearer SEU_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone":"5586999990000","message":"Teste ORTHOSCAN"}'
```

## Teste manual

Para executar a rotina assim que o WhatsApp conectar:

```bash
RUN_ON_START=true npm start
```

No Windows PowerShell:

```powershell
$env:RUN_ON_START='true'; npm start
```

## Observacoes

O servico considera foto pendente quando nao existe documento em `documents` com `category = 'foto'`, `status = 'ok'` e `data.trayNumber` igual ao numero do alinhador. A data prevista e lida de `cases.data.trays[].dueDate`; o codigo tambem aceita `data_prevista` como fallback.

Como `whatsapp-web.js` usa WhatsApp Web, mantenha a sessao autenticada e evite volumes altos de disparos. O delay aleatorio de 3 a 8 segundos reduz rajadas, mas nao substitui politicas de consentimento e uso responsavel.
