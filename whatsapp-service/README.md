# OrthoScan WhatsApp Service

Microsservico Node.js para enviar lembretes diarios de troca de alinhadores via `whatsapp-web.js`.

## Rodar localmente

```bash
cd whatsapp-service
npm install
npm start
```

Variaveis principais:

- `FIREBASE_PROJECT_ID=gostosao-3421e`
- `FIREBASE_SERVICE_ACCOUNT_JSON` ou `GOOGLE_APPLICATION_CREDENTIALS`
- `CRON_TIME=0 8 * * *`
- `TZ=America/Sao_Paulo`
- `ADMIN_TOKEN`
- `ALLOWED_ORIGIN=https://www.orthoscan.online`
- `AUTH_DATA_PATH=/data/.wwebjs_auth`

Na primeira execucao, leia o QR Code exibido no terminal pelo WhatsApp da clinica. A sessao fica salva no caminho de `AUTH_DATA_PATH`.

## Endpoints

- `GET /health`
- `GET /status?token=SEU_ADMIN_TOKEN`
- `GET /qr?token=SEU_ADMIN_TOKEN`
- `POST /send` com `Authorization: Bearer SEU_ADMIN_TOKEN`
- `POST /run-now?token=SEU_ADMIN_TOKEN`

O servico consulta `cases`, `patients` e `patient_documents` no Firestore.
