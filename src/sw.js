import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

const DEFAULT_TITLE = 'Arrimo OrthoScan'
const DEFAULT_BODY = 'Voce recebeu uma nova atualizacao.'
const DEFAULT_TARGET_URL = '/dashboard/agendamentos'
const DEFAULT_ICON = '/pwa-192x192.png'
const DEFAULT_BADGE = '/pwa-192x192.png'

function isRecord(value) {
  return Boolean(value) && typeof value === 'object'
}

function resolveTargetUrl(value) {
  try {
    return new URL(typeof value === 'string' && value.trim() ? value : DEFAULT_TARGET_URL, self.location.origin).toString()
  } catch {
    return new URL(DEFAULT_TARGET_URL, self.location.origin).toString()
  }
}

function parsePushPayload(data) {
  if (!data) return {}
  try {
    const parsed = data.json()
    return isRecord(parsed) ? parsed : {}
  } catch {
    const text = data.text()
    return text ? { body: text } : {}
  }
}

async function broadcastToClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  await Promise.all(clients.map((client) => client.postMessage(message)))
}

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event.data)
  const targetUrl = resolveTargetUrl(payload.url)
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title : DEFAULT_TITLE
  const body = typeof payload.body === 'string' && payload.body.trim() ? payload.body : DEFAULT_BODY

  event.waitUntil(
    Promise.all([
      broadcastToClients({
        type: 'arrimo.push.received',
        payload: {
          ...payload,
          title,
          body,
          url: targetUrl,
        },
      }),
      self.registration.showNotification(title, {
        body,
        icon: typeof payload.icon === 'string' ? payload.icon : DEFAULT_ICON,
        badge: typeof payload.badge === 'string' ? payload.badge : DEFAULT_BADGE,
        tag: typeof payload.tag === 'string' ? payload.tag : undefined,
        renotify: Boolean(payload.renotify),
        requireInteraction: Boolean(payload.requireInteraction),
        data: {
          ...(isRecord(payload.data) ? payload.data : {}),
          url: targetUrl,
        },
        actions: [{ action: 'open-agendamentos', title: 'Abrir agenda' }],
      }),
    ]),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = resolveTargetUrl(event.notification.data?.url)

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients) {
        const windowClient = client
        if ('navigate' in windowClient) {
          await windowClient.navigate(targetUrl).catch(() => {
            // Se a aba não puder navegar, ainda tentamos focar o cliente existente.
          })
        }
        if ('focus' in windowClient) {
          return windowClient.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    })(),
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    broadcastToClients({
      type: 'arrimo.push.subscriptionchange',
    }),
  )
})
