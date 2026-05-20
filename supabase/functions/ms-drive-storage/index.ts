import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type JsonPayload = {
  action?: 'create-link' | 'delete' | 'download-url'
  path?: string
}

type GraphAuthMode = 'app' | 'delegated'

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
  return allowedOrigins[0] ?? 'null'
}

function corsHeaders(req: Request) {
  const origin = resolveAllowedOrigin(req)
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-user-jwt, x-client-info, apikey, content-type',
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

function joinPath(...parts: string[]) {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
    .replace(/\/{2,}/g, '/')
}

function splitPath(path: string) {
  return path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
}

function encodePath(path: string) {
  return splitPath(path).map((segment) => encodeURIComponent(segment)).join('/')
}

function authMode(): GraphAuthMode {
  const mode = (Deno.env.get('MS_AUTH_MODE') ?? 'app').trim().toLowerCase()
  return mode === 'delegated' ? 'delegated' : 'app'
}

async function graphToken() {
  const mode = authMode()
  const clientId = Deno.env.get('MS_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('MS_CLIENT_SECRET') ?? ''

  if (!clientId || !clientSecret) {
    return { ok: false as const, error: 'MS_CLIENT_ID/MS_CLIENT_SECRET ausente.' }
  }

  if (mode === 'delegated') {
    const authority = (Deno.env.get('MS_AUTHORITY') ?? 'consumers').trim()
    const refreshToken = Deno.env.get('MS_REFRESH_TOKEN') ?? ''
    if (!refreshToken) return { ok: false as const, error: 'MS_REFRESH_TOKEN ausente para o modo delegado.' }

    const response = await fetch(`https://login.microsoftonline.com/${authority}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        scope: 'offline_access openid profile Files.ReadWrite User.Read',
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      return { ok: false as const, error: `Erro no token delegado do Graph: ${text}` }
    }
    const data = (await response.json()) as { access_token?: string }
    if (!data.access_token) return { ok: false as const, error: 'Token delegado do Graph sem access_token.' }
    return { ok: true as const, token: data.access_token, mode }
  }

  const tenantId = Deno.env.get('MS_TENANT_ID') ?? ''
  if (!tenantId) return { ok: false as const, error: 'MS_TENANT_ID ausente para o modo app.' }

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    return { ok: false as const, error: `Erro no token de app do Graph: ${text}` }
  }
  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) return { ok: false as const, error: 'Token de app do Graph sem access_token.' }
  return { ok: true as const, token: data.access_token, mode }
}

function graphDriveBase(mode: GraphAuthMode, driveId: string | null) {
  if (mode === 'delegated') return 'https://graph.microsoft.com/v1.0/me/drive'
  return `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId ?? '')}`
}

async function graphFetch(token: string, input: string, init?: RequestInit) {
  return fetch(input, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
}

async function ensureFolders(token: string, base: string, fullParentPath: string) {
  const segments = splitPath(fullParentPath)
  if (segments.length === 0) return { ok: true as const }

  let cumulative = ''
  for (const segment of segments) {
    cumulative = joinPath(cumulative, segment)
    const encoded = encodePath(cumulative)
    const check = await graphFetch(token, `${base}/root:/${encoded}`)
    if (check.ok) continue
    if (check.status !== 404) {
      const text = await check.text()
      return { ok: false as const, error: `Falha ao verificar pasta no Graph: ${text}` }
    }

    const parentPath = splitPath(cumulative).slice(0, -1).join('/')
    const createUrl = parentPath
      ? `${base}/root:/${encodePath(parentPath)}:/children`
      : `${base}/root/children`
    const create = await graphFetch(token, createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: segment,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'replace',
      }),
    })
    if (!create.ok) {
      const text = await create.text()
      return { ok: false as const, error: `Falha ao criar pasta no Graph: ${text}` }
    }
  }
  return { ok: true as const }
}

async function getItemByPath(token: string, base: string, fullPath: string) {
  const response = await graphFetch(token, `${base}/root:/${encodePath(fullPath)}`)
  if (!response.ok) {
    const text = await response.text()
    return { ok: false as const, error: `Falha ao localizar caminho no Graph: ${text}`, status: response.status }
  }
  const item = (await response.json()) as { id?: string; webUrl?: string; '@microsoft.graph.downloadUrl'?: string }
  if (!item.id) return { ok: false as const, error: 'A busca de caminho no Graph não retornou id.', status: 500 }
  return { ok: true as const, item }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, error: 'Método não permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const driveId = Deno.env.get('MS_DRIVE_ID') ?? ''
  const basePath = (Deno.env.get('MS_DRIVE_BASE_PATH') ?? 'orthoscan').trim().replace(/^\/+|\/+$/g, '')
  const linkScope = (Deno.env.get('MS_DRIVE_LINK_SCOPE') ?? 'anonymous').trim().toLowerCase()

  if (!supabaseUrl || !serviceRoleKey) return json(req, { ok: false, error: 'SUPABASE_URL ou SERVICE_ROLE_KEY ausente.' }, 500)

  const userJwtRaw = req.headers.get('x-user-jwt') ?? ''
  const userJwt = userJwtRaw.replace(/^Bearer\s+/i, '').trim()
  if (!userJwt) return json(req, { ok: false, error: 'x-user-jwt ausente.' }, 401)

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data: authData, error: authError } = await supabase.auth.getUser(userJwt)
  if (authError || !authData.user) return json(req, { ok: false, error: 'Unauthorized.' }, 401)

  const tokenResult = await graphToken()
  if (!tokenResult.ok) return json(req, { ok: false, error: tokenResult.error }, 500)
  if (tokenResult.mode === 'app' && !driveId) return json(req, { ok: false, error: 'MS_DRIVE_ID ausente para o modo app.' }, 500)

  const token = tokenResult.token
  const graphBase = graphDriveBase(tokenResult.mode, driveId || null)

  const contentType = req.headers.get('content-type') ?? ''
  let action = ''
  let path = ''
  let file: File | null = null

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    action = String(form.get('action') ?? '')
    path = String(form.get('path') ?? '')
    file = form.get('file') as File | null
  } else {
    const payload = (await req.json()) as JsonPayload
    action = String(payload.action ?? '')
    path = String(payload.path ?? '')
  }

  const cleanPath = splitPath(path).join('/')
  if (!cleanPath) return json(req, { ok: false, error: 'Caminho ausente.' }, 400)
  const fullPath = joinPath(basePath, cleanPath)

  if (action === 'upload') {
    if (!file) return json(req, { ok: false, error: 'Arquivo ausente.' }, 400)
    const parts = splitPath(fullPath)
    if (parts.length < 1) return json(req, { ok: false, error: 'Caminho inválido.' }, 400)
    const parentPath = parts.slice(0, -1).join('/')
    const ensure = await ensureFolders(token, graphBase, parentPath)
    if (!ensure.ok) return json(req, { ok: false, error: ensure.error }, 500)

    const upload = await graphFetch(token, `${graphBase}/root:/${encodePath(fullPath)}:/content`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file.stream(),
    })
    if (!upload.ok) {
      const text = await upload.text()
      return json(req, { ok: false, error: `Falha no envio ao Graph: ${text}` }, 500)
    }
    return json(req, { ok: true })
  }

  if (action === 'create-link') {
    const itemResult = await getItemByPath(token, graphBase, fullPath)
    if (!itemResult.ok) {
      const status = itemResult.status === 404 ? 404 : 500
      return json(req, { ok: false, error: itemResult.error }, status)
    }
    const createLink = await graphFetch(token, `${graphBase}/items/${itemResult.item.id}/createLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'view', scope: linkScope }),
    })
    if (!createLink.ok) {
      const text = await createLink.text()
      return json(req, { ok: false, error: `Falha ao criar link no Graph: ${text}` }, 500)
    }
    const data = (await createLink.json()) as { link?: { webUrl?: string } }
    const url = data.link?.webUrl ?? itemResult.item.webUrl
    if (!url) return json(req, { ok: false, error: 'A criação de link no Graph não retornou URL.' }, 500)
    return json(req, { ok: true, url })
  }

  if (action === 'download-url') {
    const itemResult = await getItemByPath(token, graphBase, fullPath)
    if (!itemResult.ok) {
      const status = itemResult.status === 404 ? 404 : 500
      return json(req, { ok: false, error: itemResult.error }, status)
    }
    const url = itemResult.item['@microsoft.graph.downloadUrl']
    if (!url) return json(req, { ok: false, error: 'O item do Graph não possui URL de download.' }, 500)
    return json(req, { ok: true, url })
  }

  if (action === 'delete') {
    const remove = await graphFetch(token, `${graphBase}/root:/${encodePath(fullPath)}`, {
      method: 'DELETE',
    })
    if (!remove.ok && remove.status !== 404) {
      const text = await remove.text()
      return json(req, { ok: false, error: `Falha ao excluir no Graph: ${text}` }, 500)
    }
    return json(req, { ok: true })
  }

  return json(req, { ok: false, error: 'Ação inválida.' }, 400)
})
