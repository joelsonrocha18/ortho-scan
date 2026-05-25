import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { UploadCloud } from 'lucide-react'
import { uploadFile } from '../../../../shared/infra/firebaseStorageService'

type UploadRow = { name: string; progress: number; status: 'uploading' | 'done' | 'error' }

export default function ScanUploader({ patientId = 'sem-paciente' }: { patientId?: string }) {
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const onDrop = useCallback(
    (files: File[]) => {
      files.forEach((file) => {
        setUploads((current) => [...current, { name: file.name, progress: 0, status: 'uploading' }])
        void uploadFile(file, `patients/${patientId}/scans/${Date.now()}-${file.name}`, (progress) => {
          setUploads((current) => current.map((row) => (row.name === file.name ? { ...row, progress } : row)))
        })
          .then(() => setUploads((current) => current.map((row) => (row.name === file.name ? { ...row, progress: 100, status: 'done' } : row))))
          .catch(() => setUploads((current) => current.map((row) => (row.name === file.name ? { ...row, status: 'error' } : row))))
      })
    },
    [patientId],
  )
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: true, accept: { 'model/stl': ['.stl'], 'model/obj': ['.obj'], 'model/ply': ['.ply'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'application/dicom': ['.dcm'] } })

  return (
    <div className="space-y-3">
      <div {...getRootProps()} className="cursor-pointer rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center transition hover:border-brand-300">
        <input {...getInputProps()} />
        <UploadCloud className="mx-auto h-8 w-8 text-brand-600" />
        <p className="mt-2 font-medium text-slate-900">{isDragActive ? 'Solte os arquivos aqui' : 'Arraste scans ou clique para enviar'}</p>
        <p className="mt-1 text-sm text-slate-500">STL, OBJ, PLY, JPG, PNG e DICOM.</p>
      </div>
      {uploads.map((upload) => (
        <div key={upload.name} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="truncate font-medium text-slate-700">{upload.name}</span>
            <span className="text-slate-500">{upload.status === 'done' ? 'Concluído' : upload.status === 'error' ? 'Falha' : `${Math.round(upload.progress)}%`}</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${upload.progress}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
