import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

type SendWebPushPayload = {
  userId?: string
  title?: string
  body?: string
  url?: string
  tag?: string
  icon?: string
  badge?: string
  data?: Record<string, unknown>
  requireInteraction?: boolean
  renotify?: boolean
}

type ProfileRow = {
  user_id: string
  role: string
  clinic_id: string | null
}

type SubscriptionRow = {
  id: string
  user_id: string
  endpoint: string
  subscription: Record<string, unknown>
}

function resolveAllowedOrigin(req: Request) {
  const configured = (Deno.env.get('ALLOWED_ORIGIN') ?? '').trim()
  const allowedOrigins = configured
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').trim()
  if (siteUrl) {
    try {
      const siteOrigin = new URL(siteUrl).origin
      if (!allowedOrigins.includes(siteOrigin)) allowedOrigins.push(siteOrigin)
    } catch {
      // Ignore invalid SITE_URL and fall back to ALLOWED_ORIGIN.
    }
  }
  const requestOrigin = (req.headers.get('origin') ?? '').replace(/\/$/, '')
  if (allowedOrigins.includes('*')) return requestOrigin || '*'
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) return requestOrigin
  return allowedOrigins[0] ?? (requestOrigin || '*')
}

function corsHeaders(req: Request) {
  const origin = resolveAllowedOrigin(req)
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function resolveServiceConfig() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const vapidPublicKey = Deno.env.get('WEB_PUSH_PUBLIC_KEY') ?? ''
  const vapidPrivateKey = Deno.env.get('WEB_PUSH_PRIVATE_KEY') ?? ''
  const vapidSubject = Deno.env.get('WEB_PUSH_SUBJECT') ?? 'mailto:suporte@orthoscan.com'

  return {
    supabaseUrl,
    serviceRoleKey,
    vapidPublicKey,
    vapidPrivateKey,
    vapidSubject,
  }
}

function isAdminRole(role?: string | null) {
  return ['master_admin', 'dentist_admin', 'lab_tech', 'receptionist'].includes(role ?? '')
}

function isGoneStatus(statusCode?: number) {
  return statusCode === 404 || statusCode === 410
}

async function loadActorProfile(supabase: ReturnType<typeof createClient>, actorUserId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, role, clinic_id')
    .eq('user_id', actorUserId)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as ProfileRow | null
}

async function loadTargetProfile(supabase: ReturnType<typeof createClient>, targetUserId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, role, clinic_id')
    .eq('user_id', targetUserId)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as ProfileRow | null
}

async function loadSubscriptions(supabase: ReturnType<typeof createClient>, targetUserId: string) {
  const { data, error } = await supabase
    .from('user_push_subscriptions')
    .select('id, user_id, endpoint, subscription')
    .eq('user_id', targetUserId)
    .is('disabled_at', null)

  if (error) throw error
  return (data ?? []) as SubscriptionRow[]
}

async function disableSubscriptionById(supabase: ReturnType<typeof createClient>, subscriptionId: string) {
  await supabase
    .from('user_push_subscriptions')
    .update({ disabled_at: new Date().toISOString() })
    .eq('id', subscriptionId)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, error: 'Método não permitido.' }, 405)

  const { supabaseUrl, serviceRoleKey, vapidPublicKey, vapidPrivateKey, vapidSubject } = resolveServiceConfig()
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return json(req, { ok: false, error: 'Configuração do Supabase ou VAPID ausente.' }, 500)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user: actor },
    error: actorError,
  } = await supabase.auth.getUser()
  if (actorError || !actor) {
    return json(req, { ok: false, error: 'Unauthorized.' }, 401)
  }

  const actorProfile = await loadActorProfile(supabase, actor.id)
  if (!actorProfile) {
    return json(req, { ok: false, error: 'Perfil do ator não encontrado.' }, 403)
  }

  const payload = (await req.json()) as SendWebPushPayload
  const targetUserId = (payload.userId ?? actor.id).trim()
  if (!targetUserId) {
    return json(req, { ok: false, error: 'userId inválido.' }, 400)
  }

  const targetProfile = await loadTargetProfile(supabase, targetUserId)
  if (!targetProfile) {
    return json(req, { ok: false, error: 'Usuário de destino não encontrado.' }, 404)
  }

  const sameClinic = actorProfile.clinic_id && targetProfile.clinic_id
    ? actorProfile.clinic_id === targetProfile.clinic_id
    : actor.id === targetUserId
  const canSend =
    actor.id === targetUserId ||
    actorProfile.role === 'master_admin' ||
    (isAdminRole(actorProfile.role) && sameClinic)

  if (!canSend) {
    return json(req, { ok: false, error: 'Forbidden.' }, 403)
  }

  const subscriptions = await loadSubscriptions(supabase, targetUserId)
  if (subscriptions.length === 0) {
    return json(req, { ok: false, error: 'Nenhuma subscription ativa para o usuário informado.' }, 404)
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

  const notificationPayload = JSON.stringify({
    title: payload.title?.trim() || 'Arrimo OrthoScan',
    body: payload.body?.trim() || 'Voce recebeu uma nova notificacao.',
    url: payload.url?.trim() || '/dashboard/agendamentos',
    tag: payload.tag?.trim() || undefined,
    icon: payload.icon?.trim() || '/pwa-192x192.png',
    badge: payload.badge?.trim() || '/pwa-192x192.png',
    data: payload.data ?? {},
    requireInteraction: Boolean(payload.requireInteraction),
    renotify: Boolean(payload.renotify),
  })

  let delivered = 0
  let disabled = 0
  const failures: Array<{ endpoint: string; statusCode?: number; message: string }> = []

  for (const subscriptionRow of subscriptions) {
    try {
      await webpush.sendNotification(subscriptionRow.subscription as webpush.PushSubscription, notificationPayload, {
        TTL: 60,
      })
      delivered += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const statusCode = typeof error === 'object' && error && 'statusCode' in error
        ? Number((error as { statusCode?: number }).statusCode)
        : undefined

      failures.push({
        endpoint: subscriptionRow.endpoint,
        statusCode,
        message,
      })

      if (isGoneStatus(statusCode)) {
        await disableSubscriptionById(supabase, subscriptionRow.id)
        disabled += 1
      }
    }
  }

  await supabase.from('security_audit_logs').insert({
    event_type: 'web_push_sent',
    actor_user_id: actor.id,
    metadata: {
      target_user_id: targetUserId,
      delivered,
      disabled,
      attempted: subscriptions.length,
      failures,
    },
  })

  if (delivered === 0) {
    return json(req, { ok: false, error: 'Nenhuma notificacao foi entregue.', failures }, 502)
  }

  return json(req, {
    ok: true,
    data: {
      delivered,
      attempted: subscriptions.length,
      disabled,
      failures,
    },
  })
})
