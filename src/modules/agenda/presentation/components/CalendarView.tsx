import { Calendar, dateFnsLocalizer, type View } from 'react-big-calendar'
import { format, getDay, parse, startOfWeek } from 'date-fns'
import { ptBR } from 'date-fns/locale/pt-BR'
import 'react-big-calendar/lib/css/react-big-calendar.css'

export type CalendarViewMode = 'day' | 'week' | 'month'

export type AgendaEvent = {
  id: string
  title: string
  type: 'scan' | 'planning' | 'delivery' | 'consultation' | 'other'
  start: Date
  end: Date
  patient_id?: string
  patient_name?: string
  dentist_id?: string
  dentist_name?: string
  case_id?: string
  notes?: string
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
  color: string
}

type CalendarViewProps = {
  events: AgendaEvent[]
  mode: CalendarViewMode
  date: Date
  onModeChange: (mode: CalendarViewMode) => void
  onDateChange: (date: Date) => void
  onSelectEvent: (event: AgendaEvent) => void
  onMoveEvent?: (event: AgendaEvent, start: Date, end: Date) => void
}

const locales = { 'pt-BR': ptBR }
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales })

const messages = {
  today: 'Hoje',
  previous: 'Anterior',
  next: 'Próximo',
  month: 'Mês',
  week: 'Semana',
  day: 'Dia',
  agenda: 'Agenda',
  date: 'Data',
  time: 'Hora',
  event: 'Evento',
  noEventsInRange: 'Nenhum evento neste período.',
}

export default function CalendarView({ events, mode, date, onModeChange, onDateChange, onSelectEvent }: CalendarViewProps) {
  return (
    <div className="h-[720px] rounded-lg border border-slate-200 bg-white p-3">
      <Calendar
        localizer={localizer}
        culture="pt-BR"
        messages={messages}
        events={events}
        date={date}
        view={mode}
        views={['month', 'week', 'day']}
        startAccessor="start"
        endAccessor="end"
        onNavigate={onDateChange}
        onView={(view: View) => onModeChange(view as CalendarViewMode)}
        onSelectEvent={onSelectEvent}
        eventPropGetter={(event) => ({
          style: {
            backgroundColor: event.color,
            borderColor: event.color,
            color: '#fff',
          },
        })}
      />
    </div>
  )
}
