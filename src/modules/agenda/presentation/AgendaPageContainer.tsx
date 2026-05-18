import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Clock, MessageCircle, Plus, RefreshCw, Repeat2, ScanLine, Stethoscope, UserRound } from 'lucide-react'
import { useToast } from '../../../app/ToastProvider'
import { can } from '../../../auth/permissions'
import Button from '../../../components/Button'
import Card from '../../../components/Card'
import Input from '../../../components/Input'
import AppShell from '../../../layouts/AppShell'
import { getCurrentUser } from '../../../lib/auth'
import { useDb } from '../../../lib/useDb'
import { agendaEventTypeLabels, useAgendaEvents, type AgendaCalendarEvent, type AgendaEventType, type AgendaManualEventType } from './hooks/useAgendaEvents'

type CalendarView = 'month' | 'week' | 'day'

type EventFormState = {
  title: string
  type: AgendaManualEventType
  start: string
  end: string
  professionalId: string
  patientId: string
  notes: string
}

const filterDefaults: Record<AgendaEventType, boolean> = {
  escaneamento: true,
  planejamento: true,
  troca_alinhador: true,
}

const weekdayLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom']

const typeStyles: Record<AgendaEventType, { chip: string; dot: string; card: string; label: string }> = {
  escaneamento: {
    chip: 'border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100',
    dot: 'bg-sky-500',
    card: 'border-sky-200 bg-sky-50/80',
    label: 'text-sky-800',
  },
  planejamento: {
    chip: 'border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100',
    dot: 'bg-amber-500',
    card: 'border-amber-200 bg-amber-50/80',
    label: 'text-amber-800',
  },
  troca_alinhador: {
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-950 hover:bg-emerald-100',
    dot: 'bg-emerald-500',
    card: 'border-emerald-200 bg-emerald-50/80',
    label: 'text-emerald-800',
  },
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function startOfWeek(date: Date) {
  const base = startOfDay(date)
  const weekday = base.getDay()
  const offset = weekday === 0 ? -6 : 1 - weekday
  return addDays(base, offset)
}

function endOfWeek(date: Date) {
  return addDays(startOfWeek(date), 6)
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

function listDays(start: Date, end: Date) {
  const days: Date[] = []
  let cursor = startOfDay(start)
  const last = startOfDay(end)
  while (cursor <= last) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return days
}

function viewRange(view: CalendarView, anchorDate: Date) {
  if (view === 'day') {
    const day = startOfDay(anchorDate)
    return { start: day, end: day }
  }
  if (view === 'week') {
    return { start: startOfWeek(anchorDate), end: endOfWeek(anchorDate) }
  }
  return {
    start: startOfWeek(startOfMonth(anchorDate)),
    end: endOfWeek(endOfMonth(anchorDate)),
  }
}

function moveAnchor(view: CalendarView, anchorDate: Date, direction: -1 | 1) {
  const next = new Date(anchorDate)
  if (view === 'month') next.setMonth(next.getMonth() + direction)
  if (view === 'week') next.setDate(next.getDate() + direction * 7)
  if (view === 'day') next.setDate(next.getDate() + direction)
  return next
}

function formatRangeTitle(view: CalendarView, anchorDate: Date, range: { start: Date; end: Date }) {
  if (view === 'month') {
    return anchorDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  }
  if (view === 'day') {
    return anchorDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  }
  const start = range.start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  const end = range.end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
  return `${start} - ${end}`
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatDateLong(dateKey: string) {
  return fromDateKey(dateKey).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
}

function toDateTimeLocalValue(date: Date) {
  return `${toDateKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function defaultForm(dateKey?: string): EventFormState {
  const start = dateKey ? fromDateKey(dateKey) : new Date()
  if (dateKey) {
    start.setHours(9, 0, 0, 0)
  } else {
    start.setMinutes(0, 0, 0)
    start.setHours(start.getHours() + 1)
  }
  const end = new Date(start)
  end.setHours(end.getHours() + 1)
  return {
    title: agendaEventTypeLabels.escaneamento,
    type: 'escaneamento',
    start: toDateTimeLocalValue(start),
    end: toDateTimeLocalValue(end),
    professionalId: '',
    patientId: '',
    notes: '',
  }
}

function eventIcon(type: AgendaEventType, className = 'h-4 w-4') {
  if (type === 'escaneamento') return <ScanLine className={className} />
  if (type === 'planejamento') return <ClipboardList className={className} />
  return <Repeat2 className={className} />
}

function groupEventsByDate(events: AgendaCalendarEvent[]) {
  const grouped = new Map<string, AgendaCalendarEvent[]>()
  events.forEach((event) => {
    const current = grouped.get(event.date) ?? []
    grouped.set(event.date, [...current, event])
  })
  grouped.forEach((items, key) => {
    grouped.set(key, [...items].sort((left, right) => left.start.localeCompare(right.start)))
  })
  return grouped
}

function AgendaEventChip({ event, onSelect }: { event: AgendaCalendarEvent; onSelect: (eventId: string) => void }) {
  const style = typeStyles[event.type]
  return (
    <button
      type="button"
      onClick={() => onSelect(event.id)}
      className={`flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1 text-left text-xs font-semibold transition ${style.chip}`}
      title={event.title}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
      <span className="shrink-0 tabular-nums">{formatTime(event.start)}</span>
      <span className="truncate">{event.title}</span>
    </button>
  )
}

function AgendaEventCard({ event, onSelect }: { event: AgendaCalendarEvent; onSelect: (eventId: string) => void }) {
  const style = typeStyles[event.type]
  return (
    <button
      type="button"
      onClick={() => onSelect(event.id)}
      className={`w-full rounded-lg border p-3 text-left transition hover:shadow-sm ${style.card}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-950">{event.title}</p>
            <p className="mt-1 text-xs font-semibold text-slate-600">
              {formatTime(event.start)} - {formatTime(event.end)}
            </p>
          </div>
        </div>
        <span className={`shrink-0 text-xs font-bold ${style.label}`}>{agendaEventTypeLabels[event.type]}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-700">
        {event.professionalName ? (
          <span className="inline-flex items-center gap-1">
            <Stethoscope className="h-3.5 w-3.5" />
            {event.professionalName}
          </span>
        ) : null}
        {event.patientName ? (
          <span className="inline-flex items-center gap-1">
            <UserRound className="h-3.5 w-3.5" />
            {event.patientName}
          </span>
        ) : null}
      </div>
    </button>
  )
}

function EventDetails({ event }: { event?: AgendaCalendarEvent }) {
  if (!event) {
    return (
      <Card className="ui-surface-panel">
        <h2 className="text-lg font-semibold text-slate-900">Detalhes</h2>
        <p className="mt-2 text-sm text-slate-600">Selecione um item do calendario.</p>
      </Card>
    )
  }

  return (
    <Card className="ui-surface-panel">
      <div className="flex items-start gap-3">
        <div className={`rounded-lg border p-2 ${typeStyles[event.type].card}`}>{eventIcon(event.type)}</div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-slate-500">{agendaEventTypeLabels[event.type]}</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{event.title}</h2>
        </div>
      </div>
      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="font-semibold text-slate-500">Data</dt>
          <dd className="text-slate-900">{formatDateLong(event.date)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-500">Horario</dt>
          <dd className="text-slate-900">
            {formatTime(event.start)} - {formatTime(event.end)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-500">Paciente</dt>
          <dd className="text-slate-900">{event.patientName ?? '-'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-500">Profissional</dt>
          <dd className="text-slate-900">{event.professionalName ?? '-'}</dd>
        </div>
        {event.trayLabel ? (
          <div>
            <dt className="font-semibold text-slate-500">Alinhador</dt>
            <dd className="text-slate-900">{event.trayLabel}</dd>
          </div>
        ) : null}
        {event.notes ? (
          <div>
            <dt className="font-semibold text-slate-500">Observacoes</dt>
            <dd className="text-slate-900">{event.notes}</dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        {event.caseId ? (
          <Link to={`/app/cases/${event.caseId}`} className="inline-flex h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Abrir caso
          </Link>
        ) : null}
        {event.whatsappHref ? (
          <a
            href={event.whatsappHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </a>
        ) : null}
      </div>
    </Card>
  )
}

export default function AgendaPageContainer() {
  const { db } = useDb()
  const currentUser = getCurrentUser(db)
  const canWrite = can(currentUser, 'agenda.write')
  const { addToast } = useToast()
  const [view, setView] = useState<CalendarView>('month')
  const [anchorDate, setAnchorDate] = useState(() => new Date())
  const [filters, setFilters] = useState<Record<AgendaEventType, boolean>>(filterDefaults)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<EventFormState>(() => defaultForm())
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const range = useMemo(() => viewRange(view, anchorDate), [anchorDate, view])
  const days = useMemo(() => listDays(range.start, range.end), [range.end, range.start])
  const { events, loading, error, patientOptions, professionalOptions, createManualEvent, refresh } = useAgendaEvents(range.start, range.end)

  const filteredEvents = useMemo(() => events.filter((event) => filters[event.type]), [events, filters])
  const eventsByDate = useMemo(() => groupEventsByDate(filteredEvents), [filteredEvents])
  const selectedEvent = useMemo(() => filteredEvents.find((event) => event.id === selectedEventId), [filteredEvents, selectedEventId])
  const todayKey = toDateKey(new Date())
  const todayReminders = filteredEvents.filter((event) => event.type === 'troca_alinhador' && event.date === todayKey)

  const openForm = (dateKey?: string) => {
    if (!canWrite) return
    setForm(defaultForm(dateKey))
    setFormError('')
    setFormOpen(true)
  }

  const toggleFilter = (type: AgendaEventType) => {
    setFilters((current) => ({ ...current, [type]: !current[type] }))
  }

  const handleTypeChange = (type: AgendaManualEventType) => {
    setForm((current) => {
      const previousLabel = agendaEventTypeLabels[current.type]
      return {
        ...current,
        type,
        title: current.title.trim().length === 0 || current.title === previousLabel ? agendaEventTypeLabels[type] : current.title,
      }
    })
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')
    setSubmitting(true)
    const result = await createManualEvent({
      title: form.title,
      type: form.type,
      startIso: new Date(form.start).toISOString(),
      endIso: new Date(form.end).toISOString(),
      professionalId: form.professionalId || undefined,
      patientId: form.patientId || undefined,
      notes: form.notes,
    })
    setSubmitting(false)
    if (!result.ok) {
      setFormError(result.error)
      addToast({ type: 'error', title: 'Agenda', message: result.error })
      return
    }
    setFormOpen(false)
    addToast({ type: 'success', title: 'Evento criado' })
  }

  return (
    <AppShell breadcrumb={['Inicio', 'Agenda']}>
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Agenda</h1>
          <p className="mt-1 text-sm text-slate-600">Atendimentos operacionais e lembretes automaticos de troca.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={refresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Atualizar
          </Button>
          {canWrite ? (
            <Button onClick={() => openForm()}>
              <Plus className="mr-2 h-4 w-4" />
              Novo evento
            </Button>
          ) : null}
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="ui-surface-panel overflow-hidden p-0">
          <div className="border-b border-slate-200 px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setAnchorDate((current) => moveAnchor(view, current, -1))} aria-label="Periodo anterior">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setAnchorDate(new Date())}>
                  Hoje
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setAnchorDate((current) => moveAnchor(view, current, 1))} aria-label="Proximo periodo">
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <div className="ml-1 inline-flex items-center gap-2 text-sm font-bold text-slate-900">
                  <CalendarDays className="h-4 w-4 text-brand-600" />
                  <span className="capitalize">{formatRangeTitle(view, anchorDate, range)}</span>
                </div>
              </div>
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
                {(['month', 'week', 'day'] as CalendarView[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setView(item)}
                    className={`h-8 rounded-md px-3 text-sm font-semibold transition ${view === item ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    {item === 'month' ? 'Mes' : item === 'week' ? 'Semana' : 'Dia'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              {(['escaneamento', 'planejamento', 'troca_alinhador'] as AgendaEventType[]).map((type) => (
                <label key={type} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={filters[type]} onChange={() => toggleFilter(type)} />
                  <span className={`h-2.5 w-2.5 rounded-full ${typeStyles[type].dot}`} />
                  {agendaEventTypeLabels[type]}
                </label>
              ))}
            </div>
          </div>

          {error ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{error}</div>
          ) : null}

          {loading ? (
            <div className="border-b border-slate-200 px-4 py-3 text-sm text-slate-600">Carregando agenda...</div>
          ) : null}

          {view === 'month' ? (
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                  {weekdayLabels.map((label) => (
                    <div key={label} className="px-3 py-2 text-xs font-bold uppercase text-slate-500">
                      {label}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {days.map((day) => {
                    const key = toDateKey(day)
                    const dayEvents = eventsByDate.get(key) ?? []
                    const isCurrentMonth = day.getMonth() === anchorDate.getMonth()
                    const isToday = key === todayKey
                    return (
                      <div key={key} className={`min-h-36 border-b border-r border-slate-200 p-2 ${isCurrentMonth ? 'bg-white' : 'bg-slate-50/70'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full text-sm font-bold ${isToday ? 'bg-brand-500 text-white' : isCurrentMonth ? 'text-slate-800' : 'text-slate-400'}`}>
                            {day.getDate()}
                          </span>
                          {canWrite ? (
                            <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-700" onClick={() => openForm(key)} aria-label="Adicionar evento">
                              <Plus className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-2 space-y-1">
                          {dayEvents.slice(0, 4).map((event) => (
                            <AgendaEventChip key={event.id} event={event} onSelect={setSelectedEventId} />
                          ))}
                          {dayEvents.length > 4 ? <p className="text-xs font-semibold text-slate-500">+{dayEvents.length - 4} itens</p> : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : null}

          {view === 'week' ? (
            <div className="overflow-x-auto">
              <div className="grid min-w-[820px] grid-cols-7 divide-x divide-slate-200">
                {days.map((day) => {
                  const key = toDateKey(day)
                  const dayEvents = eventsByDate.get(key) ?? []
                  return (
                    <div key={key} className="min-h-[520px] bg-white">
                      <div className="flex min-h-16 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                        <div>
                          <p className="text-xs font-bold uppercase text-slate-500">{weekdayLabels[(day.getDay() + 6) % 7]}</p>
                          <p className={`text-lg font-bold ${key === todayKey ? 'text-brand-700' : 'text-slate-900'}`}>{day.getDate()}</p>
                        </div>
                        {canWrite ? (
                          <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-brand-700" onClick={() => openForm(key)} aria-label="Adicionar evento">
                            <Plus className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                      <div className="space-y-2 p-3">
                        {dayEvents.map((event) => (
                          <AgendaEventCard key={event.id} event={event} onSelect={setSelectedEventId} />
                        ))}
                        {dayEvents.length === 0 ? <p className="py-6 text-center text-xs font-semibold text-slate-400">Sem eventos</p> : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {view === 'day' ? (
            <div className="bg-white p-4">
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-xs font-bold uppercase text-slate-500">Dia selecionado</p>
                  <p className="text-lg font-bold text-slate-900">{formatDateLong(toDateKey(anchorDate))}</p>
                </div>
                {canWrite ? (
                  <Button size="sm" onClick={() => openForm(toDateKey(anchorDate))}>
                    <Plus className="mr-2 h-4 w-4" />
                    Adicionar
                  </Button>
                ) : null}
              </div>
              <div className="space-y-3">
                {(eventsByDate.get(toDateKey(anchorDate)) ?? []).map((event) => (
                  <AgendaEventCard key={event.id} event={event} onSelect={setSelectedEventId} />
                ))}
                {(eventsByDate.get(toDateKey(anchorDate)) ?? []).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm font-semibold text-slate-500">
                    Nenhum evento neste dia.
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </Card>

        <aside className="space-y-4">
          <Card className="ui-surface-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Contatos de hoje</h2>
                <p className="text-sm text-slate-600">{todayReminders.length} troca(s) prevista(s)</p>
              </div>
              <Repeat2 className="h-5 w-5 text-emerald-700" />
            </div>
            <div className="mt-4 space-y-3">
              {todayReminders.map((event) => (
                <div key={event.id} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <button type="button" className="w-full text-left text-sm font-bold text-slate-950" onClick={() => setSelectedEventId(event.id)}>
                    {event.patientName ?? event.title}
                  </button>
                  <p className="mt-1 text-xs font-semibold text-emerald-900">{event.trayLabel}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {event.whatsappHref ? (
                      <a href={event.whatsappHref} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700">
                        <MessageCircle className="h-4 w-4" />
                        WhatsApp
                      </a>
                    ) : (
                      <span className="text-xs font-semibold text-slate-500">Sem WhatsApp cadastrado</span>
                    )}
                  </div>
                </div>
              ))}
              {todayReminders.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm font-semibold text-slate-500">
                  Nenhuma troca para contato hoje.
                </p>
              ) : null}
            </div>
          </Card>
          <EventDetails event={selectedEvent} />
        </aside>
      </section>

      {formOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 px-4 py-6">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Novo evento</h2>
                <p className="mt-1 text-sm text-slate-600">Crie escaneamentos e planejamentos para a equipe.</p>
              </div>
              <button type="button" className="rounded-lg px-2 py-1 text-sm font-bold text-slate-500 hover:bg-slate-100" onClick={() => setFormOpen(false)}>
                Fechar
              </button>
            </div>
            <form className="mt-5 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">
                  Tipo
                  <select
                    value={form.type}
                    onChange={(event) => handleTypeChange(event.target.value as AgendaManualEventType)}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm text-slate-950 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  >
                    <option value="escaneamento">Escaneamento</option>
                    <option value="planejamento">Planejamento</option>
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Titulo
                  <Input className="mt-1" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Inicio
                  <Input className="mt-1" type="datetime-local" value={form.start} onChange={(event) => setForm((current) => ({ ...current, start: event.target.value }))} />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Fim
                  <Input className="mt-1" type="datetime-local" value={form.end} onChange={(event) => setForm((current) => ({ ...current, end: event.target.value }))} />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Profissional
                  <select
                    value={form.professionalId}
                    onChange={(event) => setForm((current) => ({ ...current, professionalId: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm text-slate-950 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  >
                    <option value="">Sem profissional vinculado</option>
                    {professionalOptions.map((professional) => (
                      <option key={professional.id} value={professional.id}>
                        {professional.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Paciente
                  <select
                    value={form.patientId}
                    onChange={(event) => setForm((current) => ({ ...current, patientId: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm text-slate-950 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  >
                    <option value="">Sem paciente vinculado</option>
                    {patientOptions.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patient.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-sm font-semibold text-slate-700">
                Observacoes
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  className="mt-1 min-h-24 w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
              </label>
              {formError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{formError}</p> : null}
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                <Button variant="ghost" onClick={() => setFormOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={submitting}>
                  <Clock className="mr-2 h-4 w-4" />
                  {submitting ? 'Salvando...' : 'Salvar evento'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </AppShell>
  )
}
