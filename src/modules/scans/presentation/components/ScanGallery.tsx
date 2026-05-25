import { Download, Eye, FileBox } from 'lucide-react'
import Button from '../../../../components/Button'
import type { ScanAttachment } from '../../../../types/Scan'

export type ScanItem = {
  id: string
  type: '3d_scan' | 'photo_intraoral' | 'photo_extraoral' | 'xray_panoramic' | 'xray_cephalometric'
  file_url: string
  thumbnail_url?: string
  patient_id: string
  patient_name: string
  case_id?: string
  uploaded_by: string
  uploaded_at: Date
  file_size_bytes: number
  metadata?: { scanner_model?: string; resolution?: string }
}

export function scanAttachmentToItem(scanId: string, patientName: string, attachment: ScanAttachment): ScanItem {
  return {
    id: attachment.id,
    type: attachment.kind === 'scan3d' ? '3d_scan' : attachment.kind === 'foto_extra' ? 'photo_extraoral' : attachment.kind === 'raiox' ? 'xray_panoramic' : 'photo_intraoral',
    file_url: attachment.url ?? attachment.filePath ?? '',
    patient_id: scanId,
    patient_name: patientName,
    uploaded_by: 'Equipe',
    uploaded_at: new Date(attachment.createdAt),
    file_size_bytes: attachment.size ?? 0,
  }
}

export default function ScanGallery({ scans, onPreview }: { scans: ScanItem[]; onPreview?: (scan: ScanItem) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {scans.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 sm:col-span-2 xl:col-span-4">Nenhum arquivo encontrado.</div> : null}
      {scans.map((scan) => (
        <article key={scan.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex aspect-video items-center justify-center bg-slate-100">
            {scan.thumbnail_url || scan.type.startsWith('photo') ? <img src={scan.thumbnail_url ?? scan.file_url} alt={scan.patient_name} className="h-full w-full object-cover" /> : <FileBox className="h-10 w-10 text-brand-600" />}
          </div>
          <div className="space-y-3 p-4">
            <div>
              <h3 className="font-semibold text-slate-900">{scan.patient_name}</h3>
              <p className="text-sm text-slate-500">{scan.type.replaceAll('_', ' ')}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => onPreview?.(scan)}>
                <Eye className="mr-2 h-4 w-4" />
                Prévia
              </Button>
              <Button variant="ghost" size="sm" onClick={() => window.open(scan.file_url, '_blank', 'noopener,noreferrer')}>
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}
