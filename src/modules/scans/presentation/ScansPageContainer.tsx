import { useEffect, useMemo, useState } from 'react'
import { DATA_MODE } from '../../../data/dataMode'
import { listScansAsync } from '../../../data/scanRepo'
import AppShell from '../../../layouts/AppShell'
import { useDb } from '../../../lib/useDb'
import FilePreviewModal from '../../../shared/components/FilePreviewModal'
import type { Scan } from '../../../types/Scan'
import ScanGallery, { scanAttachmentToItem, type ScanItem } from './components/ScanGallery'
import ScanUploader from './components/ScanUploader'

export default function ScansPageContainer() {
  const { db } = useDb()
  const [preview, setPreview] = useState<ScanItem | null>(null)
  const [remoteScans, setRemoteScans] = useState<Scan[]>([])
  const [loading, setLoading] = useState(DATA_MODE === 'firebase')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (DATA_MODE !== 'firebase') return undefined
    let active = true
    setLoading(true)
    setError(null)

    void listScansAsync()
      .then((items) => {
        if (active) setRemoteScans(items)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar exames.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  const sourceScans = DATA_MODE === 'firebase' ? remoteScans : db.scans
  const items = useMemo(
    () =>
      sourceScans.flatMap((scan) => {
        if (scan.attachments.length > 0) {
          return scan.attachments.map((attachment) => scanAttachmentToItem(scan.id, scan.patientName, attachment))
        }
        return [{
          id: scan.id,
          type: 'photo_intraoral' as const,
          file_url: '',
          patient_id: scan.patientId ?? scan.id,
          patient_name: scan.patientName,
          case_id: scan.linkedCaseId,
          uploaded_by: 'Equipe',
          uploaded_at: new Date(scan.createdAt),
          file_size_bytes: 0,
          metadata: { scanner_model: scan.serviceOrderCode ?? scan.shortId ?? scan.id },
        }]
      }),
    [sourceScans],
  )

  return (
    <AppShell breadcrumb={['Escaneamentos']}>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-950">Escaneamentos</h1>
        <p className="mt-1 text-sm text-slate-600">Galeria, upload multiplo e pre-visualizacao de arquivos clinicos.</p>
      </div>
      {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <div className="mb-5">
        <ScanUploader />
      </div>
      <ScanGallery scans={items} loading={loading} onPreview={setPreview} />
      {preview ? <FilePreviewModal file={{ url: preview.file_url, name: preview.patient_name, type: preview.type === '3d_scan' ? '3d' : 'image' }} onClose={() => setPreview(null)} /> : null}
    </AppShell>
  )
}
