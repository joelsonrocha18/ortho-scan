import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import { useDb } from '../lib/useDb'
import { getCurrentUser } from '../lib/auth'
import { DATA_MODE } from '../data/dataMode'
import { supabase } from '../lib/supabaseClient'
import {
  ensureInternalDirectRoom,
  listInternalChatContacts,
  listInternalChatMessages,
  markInternalChatRoomRead,
  sendInternalChatMessage,
  type InternalChatContact,
  type InternalChatMessage,
} from '../repo/internalChatRepo'

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    }).format(new Date(value))
  } catch {
    return value
  }
}

export default function InternalChatWidget() {
  const { db } = useDb()
  const currentUser = getCurrentUser(db)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<InternalChatMessage[]>([])
  const [contacts, setContacts] = useState<InternalChatContact[]>([])
  const [selectedContactId, setSelectedContactId] = useState('')
  const [activeRoomKey, setActiveRoomKey] = useState('')
  const [unreadCount, setUnreadCount] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  const isSupabaseMode = DATA_MODE === 'supabase' && Boolean(supabase)
  const displayName = (currentUser?.name ?? currentUser?.email ?? '').trim() || 'Usuario'
  const myUserId = currentUser?.id ?? ''
  const selectedContact = useMemo(
    () => contacts.find((item) => item.userId === selectedContactId) ?? null,
    [contacts, selectedContactId],
  )

  useEffect(() => {
    if (!open || !listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, open])

  useEffect(() => {
    const sb = supabase
    if (!open || !isSupabaseMode || !currentUser || !sb) return
    let active = true
    setError(null)
    void listInternalChatContacts({ userId: currentUser.id, clinicId: currentUser.linkedClinicId }).then((result) => {
      if (!active) return
      if (!result.ok) {
        setError(result.error)
        return
      }
      setContacts(result.data)
      if (!selectedContactId && result.data.length > 0) {
        setSelectedContactId(result.data[0].userId)
      }
    })
    return () => {
      active = false
    }
  }, [currentUser, isSupabaseMode, open, selectedContactId])

  useEffect(() => {
    if (!open || !selectedContactId || !currentUser) return
    let active = true
    setLoading(true)
    setError(null)
    ;(async () => {
      const room = await ensureInternalDirectRoom({ me: currentUser.id, other: selectedContactId })
      if (!active) return
      if (!room.ok) {
        setError(room.error)
        setLoading(false)
        return
      }
      setActiveRoomKey(room.roomKey)
      const result = await listInternalChatMessages(room.roomKey)
      if (!active) return
      if (!result.ok) {
        setError(result.error)
        setLoading(false)
        return
      }
      setMessages(result.data)
      const lastMessageDate = result.data[result.data.length - 1]?.created_at
      await markInternalChatRoomRead({ userId: currentUser.id, roomKey: room.roomKey, readAt: lastMessageDate })
      setUnreadCount(0)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [currentUser, open, selectedContactId])

  useEffect(() => {
    const sb = supabase
    if (!isSupabaseMode || !currentUser || !sb) return
    const channel = sb
      .channel('internal-chat-private-stream')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'internal_chat_messages' },
        (payload) => {
          const row = payload.new as InternalChatMessage
          if (!row.room_key || row.room_key !== activeRoomKey) return
          const isMine = row.sender_user_id === currentUser.id
          setMessages((current) => [...current, row].slice(-200))
          if (!isMine && (!open || document.visibilityState !== 'visible')) {
            setUnreadCount((current) => current + 1)
          } else if (open) {
            void markInternalChatRoomRead({ userId: currentUser.id, roomKey: row.room_key, readAt: row.created_at })
            setUnreadCount(0)
          }
        },
      )
      .subscribe()
    return () => {
      void sb.removeChannel(channel)
    }
  }, [activeRoomKey, currentUser, isSupabaseMode, open])

  const handleSend = async () => {
    const body = message.trim()
    if (!body || !currentUser || !selectedContact || !activeRoomKey) return
    setError(null)
    const result = await sendInternalChatMessage({
      senderUserId: currentUser.id,
      senderName: displayName,
      senderRole: currentUser.role,
      body,
      roomKey: activeRoomKey,
      roomLabel: selectedContact.name,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setMessage('')
  }

  if (!isSupabaseMode || !currentUser) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-brand-600"
      >
        <MessageCircle className="h-4 w-4" />
        Chat interno
        {unreadCount > 0 ? <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] leading-none">{unreadCount}</span> : null}
      </button>
      {open ? (
        <div className="fixed bottom-20 right-5 z-40 flex h-[460px] w-[700px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
          <aside className="w-64 border-r border-slate-200">
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Conversas</p>
              <p className="text-xs text-slate-500">Privado por usuário</p>
            </div>
            <div className="h-[calc(100%-58px)] overflow-y-auto">
              {contacts.length === 0 ? <p className="px-4 py-3 text-xs text-slate-500">Sem contatos disponíveis.</p> : null}
              {contacts.map((contact) => (
                <button
                  key={contact.userId}
                  type="button"
                  onClick={() => setSelectedContactId(contact.userId)}
                  className={`w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                    selectedContactId === contact.userId ? 'bg-brand-50' : ''
                  }`}
                >
                  <p className="truncate text-sm font-semibold text-slate-900">{contact.name}</p>
                  <p className="truncate text-[11px] text-slate-500">{contact.email ?? contact.role}</p>
                </button>
              ))}
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">{selectedContact?.name ?? 'Selecione um usuário'}</p>
            </div>
            <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {loading ? <p className="text-xs text-slate-500">Carregando mensagens...</p> : null}
              {!loading && selectedContact && messages.length === 0 ? <p className="text-xs text-slate-500">Sem mensagens nessa conversa.</p> : null}
              {!loading && !selectedContact ? <p className="text-xs text-slate-500">Escolha um contato para conversar.</p> : null}
              {messages.map((item) => {
                const mine = item.sender_user_id === myUserId
                return (
                  <div key={item.id} className={`max-w-[85%] rounded-lg px-3 py-2 ${mine ? 'ml-auto bg-brand-500 text-white' : 'bg-slate-100 text-slate-800'}`}>
                    <p className={`text-[11px] font-semibold ${mine ? 'text-white/90' : 'text-slate-600'}`}>{item.sender_name}</p>
                    <p className="mt-1 text-sm">{item.body}</p>
                    <p className={`mt-1 text-[10px] ${mine ? 'text-white/80' : 'text-slate-500'}`}>{formatDateTime(item.created_at)}</p>
                  </div>
                )
              })}
            </div>
            <div className="border-t border-slate-200 px-3 py-3">
              <div className="flex items-center gap-2">
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleSend()
                    }
                  }}
                  disabled={!selectedContact}
                  placeholder={selectedContact ? 'Mensagem privada...' : 'Selecione um usuário'}
                  className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-500 disabled:bg-slate-100"
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!selectedContact}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500 text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                  aria-label="Enviar mensagem"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
