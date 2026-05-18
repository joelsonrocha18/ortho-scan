import 'dotenv/config'
import express from 'express'
import cron from 'node-cron'
import qrCodeImage from 'qrcode'
import qrcode from 'qrcode-terminal'
import { createClient } from '@supabase/supabase-js'
import whatsappWeb from 'whatsapp-web.js'

const { Client, LocalAuth } = whatsappWeb

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_TIME = process.env.CRON_TIME || '0 8 * * *'
const TZ = process.env.TZ || 'America/Sao_Paulo'
const RUN_ON_START = process.env.RUN_ON_START === 'true'
const PUPPETEER_HEADLESS = process.env.PUPPETEER_HEADLESS !== 'false'
const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || undefined
const AUTH_DATA_PATH = process.env.AUTH_DATA_PATH || './.wwebjs_auth'
const PORT = Number(process.env.PORT || 3000)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''

if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  SUPABASE_URL.includes('seu-projeto') ||
  SUPABASE_SERVICE_ROLE_KEY.includes('sua-service-role-key')
) {
  console.error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY reais no arquivo .env.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'orthoscan-aligner-reminders',
    dataPath: AUTH_DATA_PATH,
  }),
  puppeteer: {
    headless: PUPPETEER_HEADLESS,
    executablePath: PUPPETEER_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
})

let whatsappReady = false
let jobRunning = false
let jobScheduled = false
let lastQr = ''
let lastQrAt = ''
let lastJobAt = ''
let lastJobStatus = 'Servico iniciado. Aguardando WhatsApp.'

const app = express()

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    res.status(503).send('ADMIN_TOKEN nao configurado.')
    return
  }

  if (req.query.token !== ADMIN_TOKEN && req.headers.authorization !== `Bearer ${ADMIN_TOKEN}`) {
    res.status(401).send('Token invalido.')
    return
  }

  next()
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    whatsappReady,
    jobRunning,
    jobScheduled,
  })
})

app.get('/status', requireAdmin, (_req, res) => {
  res.json({
    whatsappReady,
    jobRunning,
    jobScheduled,
    lastQrAt,
    lastJobAt,
    lastJobStatus,
    cron: CRON_TIME,
    timezone: TZ,
  })
})

app.get('/qr', requireAdmin, async (_req, res) => {
  if (whatsappReady) {
    res.type('html').send('<h1>WhatsApp Pronto</h1><p>A sessao ja esta autenticada.</p>')
    return
  }

  if (!lastQr) {
    res.type('html').send('<h1>QR Code ainda nao gerado</h1><p>Aguarde alguns segundos e atualize esta pagina.</p>')
    return
  }

  const qrDataUrl = await qrCodeImage.toDataURL(lastQr)
  res.type('html').send(`
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>OrthoScan WhatsApp QR</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; color: #111827; }
          img { width: min(320px, 90vw); height: auto; }
          code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>Conectar WhatsApp</h1>
        <p>Abra o WhatsApp da clinica, entre em <strong>Aparelhos conectados</strong> e leia o QR Code.</p>
        <img src="${qrDataUrl}" alt="QR Code do WhatsApp" />
        <p>Gerado em: <code>${lastQrAt}</code></p>
      </body>
    </html>
  `)
})

app.post('/run-now', requireAdmin, async (_req, res) => {
  void runReminderJob()
  res.json({ ok: true, message: 'Rotina disparada em segundo plano.' })
})

app.listen(PORT, () => {
  console.log(`Painel online na porta ${PORT}. Use /health, /status e /qr.`)
})

client.on('qr', (qr) => {
  lastQr = qr
  lastQrAt = new Date().toISOString()
  whatsappReady = false
  console.log('Leia o QR Code abaixo com o WhatsApp do telefone da clinica:')
  qrcode.generate(qr, { small: true })
})

client.on('ready', async () => {
  whatsappReady = true
  lastQr = ''
  lastJobStatus = 'WhatsApp Pronto'
  console.log('WhatsApp Pronto')
  scheduleDailyJob()

  if (RUN_ON_START) {
    await runReminderJob()
  }
})

client.on('authenticated', () => {
  console.log(`WhatsApp autenticado. A sessao foi salva em ${AUTH_DATA_PATH}.`)
})

client.on('auth_failure', (message) => {
  whatsappReady = false
  console.error('Falha na autenticacao do WhatsApp:', message)
})

client.on('disconnected', (reason) => {
  whatsappReady = false
  console.warn('WhatsApp desconectado:', reason)
})

function scheduleDailyJob() {
  if (jobScheduled) return

  if (!cron.validate(CRON_TIME)) {
    console.error(`CRON_TIME invalido: ${CRON_TIME}`)
    process.exit(1)
  }

  cron.schedule(CRON_TIME, runReminderJob, {
    timezone: TZ,
  })

  console.log(`Cron configurado para "${CRON_TIME}" no timezone ${TZ}.`)
  jobScheduled = true
}

function todayIsoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}

function normalizePhoneToWhatsappId(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''

  const withCountryCode = digits.startsWith('55') ? digits : `55${digits}`
  return `${withCountryCode}@c.us`
}

function randomDelayMs(minSeconds = 3, maxSeconds = 8) {
  const min = minSeconds * 1000
  const max = maxSeconds * 1000
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function asObject(value) {
  return value && typeof value === 'object' ? value : {}
}

function trayNumberFromDocument(documentRow) {
  const data = asObject(documentRow.data)
  if (Number.isInteger(data.trayNumber)) return data.trayNumber

  const match = String(documentRow.title || '').match(/#(\d+)/)
  return match ? Number(match[1]) : null
}

function isTrayManuallyCompleted(caseData, trayNumber) {
  return asArray(asObject(caseData.installation).manualChangeCompletion).some((entry) => {
    const item = asObject(entry)
    return Number(item.trayNumber) === trayNumber && item.completed === true
  })
}

function buildMessage(patientName, trayNumber) {
  return `Ola ${patientName}, aqui e da clinica! Hoje e o dia previsto para voce trocar para o alinhador #${trayNumber}. Por favor, coloque a nova placa e nos envie a foto pelo sistema.`
}

async function fetchDueReminders(dateIso) {
  const { data: cases, error: casesError } = await supabase
    .from('cases')
    .select(`
      id,
      clinic_id,
      patient_id,
      data,
      patients:patient_id (
        id,
        name,
        phone,
        whatsapp
      )
    `)
    .is('deleted_at', null)
    .not('patient_id', 'is', null)

  if (casesError) {
    throw new Error(`Erro ao buscar casos: ${casesError.message}`)
  }

  const caseIds = (cases || []).map((row) => row.id)
  const photosByCaseId = new Map()

  if (caseIds.length > 0) {
    const { data: documents, error: documentsError } = await supabase
      .from('documents')
      .select('id, case_id, title, data')
      .in('case_id', caseIds)
      .eq('category', 'foto')
      .eq('status', 'ok')
      .is('deleted_at', null)

    if (documentsError) {
      throw new Error(`Erro ao buscar fotos: ${documentsError.message}`)
    }

    for (const documentRow of documents || []) {
      const trayNumber = trayNumberFromDocument(documentRow)
      if (!trayNumber) continue

      const set = photosByCaseId.get(documentRow.case_id) || new Set()
      set.add(trayNumber)
      photosByCaseId.set(documentRow.case_id, set)
    }
  }

  const reminders = []

  for (const caseRow of cases || []) {
    const caseData = asObject(caseRow.data)
    const patient = Array.isArray(caseRow.patients) ? caseRow.patients[0] : caseRow.patients
    const trays = asArray(caseData.trays)
    const photosForCase = photosByCaseId.get(caseRow.id) || new Set()

    for (const tray of trays) {
      const trayData = asObject(tray)
      const dueDate = String(trayData.dueDate || trayData.data_prevista || '').slice(0, 10)
      const trayNumber = Number(trayData.trayNumber || trayData.numero || trayData.numero_alinhador)

      if (dueDate !== dateIso || !Number.isInteger(trayNumber)) continue
      if (photosForCase.has(trayNumber)) continue
      if (isTrayManuallyCompleted(caseData, trayNumber)) continue

      reminders.push({
        caseId: caseRow.id,
        patientId: caseRow.patient_id,
        patientName: patient?.name || caseData.patientName || 'paciente',
        phone: patient?.whatsapp || patient?.phone,
        trayNumber,
      })
    }
  }

  return reminders
}

async function runReminderJob() {
  if (jobRunning) {
    console.log('Rotina ja esta em execucao. Ignorando disparo duplicado.')
    return
  }

  if (!whatsappReady) {
    console.log('WhatsApp ainda nao esta pronto. Rotina adiada.')
    return
  }

  jobRunning = true
  const dateIso = todayIsoDate()
  lastJobAt = new Date().toISOString()
  lastJobStatus = `Iniciando rotina para ${dateIso}.`
  console.log(`Iniciando rotina de lembretes de alinhadores para ${dateIso}.`)

  try {
    const reminders = await fetchDueReminders(dateIso)
    lastJobStatus = `Encontrados ${reminders.length} lembrete(s) pendente(s).`
    console.log(`Encontrados ${reminders.length} lembrete(s) pendente(s).`)

    for (const reminder of reminders) {
      const whatsappId = normalizePhoneToWhatsappId(reminder.phone)

      if (!whatsappId) {
        console.warn(`Paciente ${reminder.patientName} sem telefone valido. Pulando.`)
        continue
      }

      const message = buildMessage(reminder.patientName, reminder.trayNumber)
      await client.sendMessage(whatsappId, message)
      console.log(`Mensagem enviada para ${reminder.patientName} (${whatsappId}) - alinhador #${reminder.trayNumber}.`)

      const delay = randomDelayMs()
      console.log(`Aguardando ${Math.round(delay / 1000)}s antes do proximo envio.`)
      await sleep(delay)
    }

    lastJobStatus = 'Rotina de lembretes concluida.'
    console.log('Rotina de lembretes concluida.')
  } catch (error) {
    lastJobStatus = `Erro: ${error?.message || String(error)}`
    console.error('Erro na rotina de lembretes:', error)
  } finally {
    jobRunning = false
  }
}

process.on('SIGINT', async () => {
  console.log('Encerrando servico...')
  await client.destroy()
  process.exit(0)
})

client.initialize()
