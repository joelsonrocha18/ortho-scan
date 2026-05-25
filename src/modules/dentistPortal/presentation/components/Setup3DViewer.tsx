import { useMemo, useState } from 'react'
import { Canvas, useLoader } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import type { BufferGeometry, Group } from 'three'
import Button from '../../../../components/Button'

type Setup3DViewerProps = {
  upperArchUrl: string
  lowerArchUrl: string
  onApprove: () => void
  onRequestChanges: (notes: string) => void
}

function isObjUrl(url: string) {
  return url.toLowerCase().split('?')[0].endsWith('.obj')
}

function ArchMesh({ url, positionY }: { url: string; positionY: number }) {
  if (isObjUrl(url)) {
    return <ObjModel url={url} positionY={positionY} />
  }
  return <StlModel url={url} positionY={positionY} />
}

function ObjModel({ url, positionY }: { url: string; positionY: number }) {
  const object = useLoader(OBJLoader, url) as Group
  const cloned = useMemo(() => object.clone(), [object])
  return <primitive object={cloned} position={[0, positionY, 0]} scale={0.08} />
}

function StlModel({ url, positionY }: { url: string; positionY: number }) {
  const geometry = useLoader(STLLoader, url) as BufferGeometry
  return (
    <mesh geometry={geometry} position={[0, positionY, 0]} scale={0.08}>
      <meshStandardMaterial color="#d7f3ff" roughness={0.42} metalness={0.08} />
    </mesh>
  )
}

export function Setup3DViewer({
  upperArchUrl,
  lowerArchUrl,
  onApprove,
  onRequestChanges,
}: Setup3DViewerProps) {
  const [notes, setNotes] = useState('')

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="h-[520px] bg-slate-950">
        <Canvas camera={{ position: [0, 0.6, 7], fov: 45 }}>
          <ambientLight intensity={0.65} />
          <directionalLight position={[4, 6, 8]} intensity={1.5} />
          <directionalLight position={[-4, -2, -6]} intensity={0.45} />
          {upperArchUrl ? <ArchMesh url={upperArchUrl} positionY={0.8} /> : null}
          {lowerArchUrl ? <ArchMesh url={lowerArchUrl} positionY={-0.8} /> : null}
          <OrbitControls enablePan enableZoom enableRotate makeDefault />
        </Canvas>
      </div>
      <div className="grid gap-3 border-t border-slate-200 p-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Observacoes de ajuste</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            placeholder="Descreva os ajustes solicitados ao laboratorio."
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onRequestChanges(notes)}>
            Solicitar ajustes
          </Button>
          <Button onClick={onApprove}>Aprovar setup</Button>
        </div>
      </div>
    </section>
  )
}
