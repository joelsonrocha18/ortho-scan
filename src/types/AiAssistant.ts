import type { Timestamp } from 'firebase/firestore'

export type AiInteraction = {
  id: string
  case_id: string
  clinic_id: string
  user_uid: string
  user_role: string
  prompt: string
  response: string
  model: string
  tokens_used: number
  latency_ms: number
  created_at: Timestamp
}

export type AiAssistantMessage = {
  role: 'user' | 'assistant'
  content: string
}
