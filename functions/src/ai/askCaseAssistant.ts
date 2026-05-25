import * as functions from 'firebase-functions/v1'
import { Timestamp } from 'firebase-admin/firestore'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { db } from '../shared/admin'
import type { AiAssistantMessage } from './types'

type AiAssistantInput = {
  caseId?: string
  messages?: AiAssistantMessage[]
}

const allowedRoles = ['master_admin', 'dentist_admin', 'lab_tech', 'receptionist', 'dentist_client']
const adminRoles = ['master_admin', 'dentist_admin', 'lab_tech', 'receptionist']

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sanitizeMessages(messages: AiAssistantMessage[] | undefined): AiAssistantMessage[] {
  if (!messages) return []
  return messages
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content.trim().length > 0)
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 4000),
    }))
}

export const askCaseAssistant = functions
  .runWith({ timeoutSeconds: 60, memory: '512MB', secrets: ['OPENAI_API_KEY'] })
  .https.onCall(async (data: AiAssistantInput, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Nao autenticado.')
    }

    const callerRole = asText(context.auth.token.role)
    if (!allowedRoles.includes(callerRole)) {
      throw new functions.https.HttpsError('permission-denied', 'Perfil nao autorizado.')
    }

    const caseId = data.caseId?.trim()
    const messages = sanitizeMessages(data.messages)
    if (!caseId || messages.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'caseId e messages obrigatorios.')
    }

    const caseSnap = await db.collection('cases').doc(caseId).get()
    if (!caseSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Caso nao encontrado.')
    }

    const caseData = caseSnap.data()
    if (!caseData) {
      throw new functions.https.HttpsError('not-found', 'Caso sem dados.')
    }

    const clinicId = asText(caseData.clinic_id ?? caseData.clinicId)
    const callerClinicId = asText(context.auth.token.clinicId)
    if (callerRole !== 'master_admin' && clinicId && callerClinicId && callerClinicId !== clinicId) {
      throw new functions.https.HttpsError('permission-denied', 'Caso de outra clinica.')
    }

    const confirmSnap = await db.collection('tray_confirmations')
      .where('case_id', '==', caseId)
      .orderBy('confirmed_at', 'desc')
      .limit(10)
      .get()

    const confirmations = confirmSnap.docs.map((document) => {
      const confirmation = document.data()
      const confirmedAt = confirmation.confirmed_at
      const date = confirmedAt instanceof Timestamp
        ? confirmedAt.toDate().toLocaleDateString('pt-BR')
        : 'data nao informada'
      return {
        tray: asNumber(confirmation.tray_number, 0),
        date,
        hasSelfie: Boolean(confirmation.selfie_url),
      }
    })

    const costLine = adminRoles.includes(callerRole)
      ? `- Custo total de producao: R$ ${asNumber(caseData.total_production_cost, 0).toFixed(2)}`
      : '- Custo total de producao: indisponivel para este perfil'

    const systemPrompt = `
Voce e um assistente especializado em ortodontia digital para a plataforma OrthoScan.
Responda sempre em portugues brasileiro, com linguagem profissional e objetiva.
Nao faca diagnosticos medicos definitivos. Ofereca analises e sugestoes baseadas nos dados.
Nao exponha dados financeiros, custos de producao ou lotes para dentistas externos.

CONTEXTO DO CASO:
- Paciente: ${asText(caseData.patient_name ?? caseData.patientName) || 'N/A'}
- Status do caso: ${asText(caseData.status) || 'N/A'}
- Estagio no lab: ${asText(caseData.lab_stage ?? caseData.labStage) || 'N/A'}
- Total de bandejas: ${asNumber(caseData.total_trays ?? caseData.totalTrays, 0) || 'N/A'}
- Bandeja atual: ${asNumber(caseData.current_tray ?? caseData.currentTray, 0) || 'N/A'}
- Intervalo de troca: ${asNumber(caseData.tray_change_interval_days ?? caseData.changeEveryDays, 14)} dias
${costLine}
- Setup 3D aprovado: ${caseData.setup_3d_approved_at ? 'Sim' : 'Nao'}

ULTIMAS CONFIRMACOES DE TROCA:
${confirmations.length > 0
    ? confirmations.map((confirmation) => `- Bandeja ${confirmation.tray} confirmada em ${confirmation.date}${confirmation.hasSelfie ? ' (com selfie)' : ''}`).join('\n')
    : '- Nenhuma confirmacao registrada ainda'}
`.trim()

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const start = Date.now()
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1000,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ] satisfies ChatCompletionMessageParam[],
    })

    const latencyMs = Date.now() - start
    const responseText = completion.choices[0]?.message?.content ?? ''
    const tokensUsed = completion.usage?.total_tokens ?? 0

    await db.collection('ai_interactions').add({
      case_id: caseId,
      clinic_id: clinicId,
      user_uid: context.auth.uid,
      user_role: callerRole,
      prompt: messages[messages.length - 1]?.content ?? '',
      response: responseText,
      model: 'gpt-4o',
      tokens_used: tokensUsed,
      latency_ms: latencyMs,
      created_at: Timestamp.now(),
    })

    functions.logger.info('IA respondeu.', { caseId, tokensUsed, latencyMs })

    return {
      response: responseText,
      tokensUsed,
    }
  })
