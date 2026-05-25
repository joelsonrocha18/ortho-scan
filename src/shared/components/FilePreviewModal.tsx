import { Box, Download, FileText, Trash2, X } from 'lucide-react'
import Button from '../../components/Button'

type PreviewFile = {
  url: string
  type: 'image' | '3d' | 'pdf' | 'document'
  name: string
}

type FilePreviewModalProps = {
  file: PreviewFile
  onClose: () => void
  onDownload?: () => void
  onDelete?: () => void
}

export default function FilePreviewModal({ file, onClose, onDownload, onDelete }: FilePreviewModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label={`Pré-visualização de ${file.name}`}>
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">{file.name}</h2>
            <p className="text-xs text-slate-500">Pré-visualização do arquivo</p>
          </div>
          <div className="flex items-center gap-2">
            {onDownload ? (
              <Button variant="secondary" size="sm" onClick={onDownload} aria-label="Baixar arquivo">
                <Download className="h-4 w-4" />
              </Button>
            ) : null}
            {onDelete ? (
              <Button variant="ghost" size="sm" onClick={onDelete} aria-label="Excluir arquivo">
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar pré-visualização">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="min-h-[320px] flex-1 overflow-auto bg-slate-50 p-4">
          {file.type === 'image' ? (
            <img src={file.url} alt={file.name} className="mx-auto max-h-[70vh] max-w-full rounded-lg object-contain" />
          ) : null}
          {file.type === 'pdf' ? (
            <iframe src={file.url} title={file.name} className="h-[70vh] w-full rounded-lg border border-slate-200 bg-white" />
          ) : null}
          {file.type === '3d' ? (
            <div className="flex h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-center text-slate-600">
              <Box className="mb-3 h-10 w-10 text-brand-500" />
              <p className="font-semibold">Modelo 3D disponível</p>
              <p className="mt-1 max-w-md text-sm">Abra o arquivo no visualizador 3D do caso ou faça o download para inspeção local.</p>
            </div>
          ) : null}
          {file.type === 'document' ? (
            <div className="flex h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-center text-slate-600">
              <FileText className="mb-3 h-10 w-10 text-brand-500" />
              <p className="font-semibold">Documento pronto para download</p>
              <p className="mt-1 max-w-md text-sm">Este formato não possui pré-visualização embutida.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
