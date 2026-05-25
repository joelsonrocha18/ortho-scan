import { useState } from 'react'
import AppShell from '../../../layouts/AppShell'
import FilePreviewModal from '../../../shared/components/FilePreviewModal'
import { useDb } from '../../../lib/useDb'
import ScanGallery, { scanAttachmentToItem, type ScanItem } from './components/ScanGallery'
import ScanUploader from './components/ScanUploader'

export default function ScansPageContainer() {
  const { db } = useDb()
  const [preview, setPreview] = useState<ScanItem | null>(null)
  const items = db.scans.flatMap((scan) => scan.attachments.map((attachment) => scanAttachmentToItem(scan.id, scan.patientName, attachment))).filter((item) => item.file_url)

  return (
    <AppShell breadcrumb={['Escaneamentos']}>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-950">Escaneamentos</h1>
        <p className="mt-1 text-sm text-slate-600">Galeria, upload múltiplo e pré-visualização de arquivos clínicos.</p>
      </div>
      <div className="mb-5">
        <ScanUploader />
      </div>
      <ScanGallery scans={items} onPreview={setPreview} />
      {preview ? <FilePreviewModal file={{ url: preview.file_url, name: preview.patient_name, type: preview.type === '3d_scan' ? '3d' : 'image' }} onClose={() => setPreview(null)} /> : null}
    </AppShell>
  )
}
