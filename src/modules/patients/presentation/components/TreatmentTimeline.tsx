import { CalendarCheck } from 'lucide-react'
import Timeline, { type TimelineItem } from '../../../../shared/components/Timeline'

export type TreatmentTimelineItem = TimelineItem & {
  type: 'case_started' | 'tray_delivered' | 'tray_confirmed' | 'appointment' | 'note'
}

export default function TreatmentTimeline({ items }: { items: TreatmentTimelineItem[] }) {
  return <Timeline items={items.map((item) => ({ ...item, icon: item.icon ?? <CalendarCheck className="h-4 w-4" /> }))} />
}
