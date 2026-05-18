import { toAppError } from '../errors'
import { nowIsoDateTime } from '../utils/date'
import { readObservabilityActor } from './session'
import { sanitizeForLog } from './sanitize'
import type {
  ObservabilityActor,
  ObservabilityCategory,
  ObservabilityContext,
  ObservabilityLevel,
  StructuredLogError,
  StructuredLogRecord,
} from './types'

type LoggerPayload = {
  level: ObservabilityLevel
  category: ObservabilityCategory
  message: string
  event?: string
  context?: ObservabilityContext
  actor?: ObservabilityActor
  error?: unknown
}

export type StructuredLogSink = (record: StructuredLogRecord) => void

const structuredLogSinks = new Set<StructuredLogSink>()

export function registerStructuredLogSink(sink: StructuredLogSink) {
  structuredLogSinks.add(sink)
  return () => {
    structuredLogSinks.delete(sink)
  }
}

function normalizeError(error?: unknown): StructuredLogError | undefined {
  if (!error) return undefined
  const normalized = toAppError(error)
  return sanitizeForLog({
    name: normalized.name,
    code: normalized.code,
    message: normalized.message,
    details: normalized.details,
    stack: normalized.stack ?? (normalized.cause instanceof Error ? normalized.cause.stack : undefined),
  }) as StructuredLogError
}

export function createStructuredLogRecord(payload: LoggerPayload): StructuredLogRecord {
  const actor = sanitizeForLog(payload.actor ?? readObservabilityActor())
  const context = sanitizeForLog(payload.context ?? {}) as ObservabilityContext
  const error = normalizeError(payload.error)

  return {
    ts: nowIsoDateTime(),
    level: payload.level,
    category: payload.category,
    event: payload.event ?? (payload.category === 'business' ? 'business.event' : 'technical.event'),
    message: payload.message,
    env: import.meta.env.MODE,
    release: (import.meta.env.VITE_RELEASE as string | undefined) ?? undefined,
    actor: actor && Object.keys(actor).length > 0 ? actor : undefined,
    context,
    error,
  }
}

export function emitStructuredLog(record: StructuredLogRecord) {
  const serialized = JSON.stringify(record)
  if (record.level === 'error') {
    console.error(serialized)
  } else if (record.level === 'warn') {
    console.warn(serialized)
  } else {
    console.info(serialized)
  }
  structuredLogSinks.forEach((sink) => {
    try {
      sink(record)
    } catch {
      return undefined
    }
  })
  return record
}

function emit(payload: LoggerPayload) {
  return emitStructuredLog(createStructuredLogRecord(payload))
}

export const logger = {
  info(message: string, context?: ObservabilityContext) {
    return emit({
      level: 'info',
      category: 'technical',
      message,
      context,
    })
  },
  warn(message: string, context?: ObservabilityContext) {
    return emit({
      level: 'warn',
      category: 'technical',
      message,
      context,
    })
  },
  error(message: string, context?: ObservabilityContext, error?: unknown) {
    return emit({
      level: 'error',
      category: 'technical',
      message,
      context,
      error,
    })
  },
  business(event: string, message: string, context?: ObservabilityContext, actor?: ObservabilityActor) {
    return emit({
      level: 'info',
      category: 'business',
      event,
      message,
      context,
      actor,
    })
  },
}
