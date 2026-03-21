import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import { useSimStore } from '../state/store'
import { Scene } from './scene/Scene'
import { computeCoverageQuality } from '../sim/observe'
import { COVER_BIO, COVER_CLIMATE, COVER_SOIL } from '../sim/sensors'
import { OrbitControlsR3F } from './scene/OrbitControlsR3F'

export function Viewport() {
  const world = useSimStore((s) => s.world)
  const sensors = useSimStore((s) => s.sensors)
  const overlayMode = useSimStore((s) => s.overlayMode)
  const selectedCell = useSimStore((s) => s.selectedCell)
  const project = useSimStore((s) => s.project)
  const placingSensor = useSimStore((s) => s.placingSensor)

  const cov = useMemo(() => {
    if (!world) return null
    return computeCoverageQuality(world, sensors)
  }, [sensors, world])

  const hud = useMemo(() => {
    if (!world) return null
    const day = world.day.toFixed(1)
    return { day }
  }, [world])

  const cellInfo = useMemo(() => {
    if (!world || selectedCell == null) return null
    const c = selectedCell
    const mask = cov?.mask[c] ?? 0

    const moist = mask & COVER_SOIL ? world.moisturePct[c] : null
    const ph = mask & COVER_SOIL ? world.ph[c] : null
    const n = mask & COVER_SOIL ? world.n[c] : null
    const p = mask & COVER_SOIL ? world.p[c] : null
    const k = mask & COVER_SOIL ? world.k[c] : null

    const inv = mask & COVER_BIO ? world.invasive[c] : null
    const fire = (mask & (COVER_BIO | COVER_CLIMATE)) === (COVER_BIO | COVER_CLIMATE) ? world.fireRisk[c] : null
    const bio = mask & COVER_BIO ? world.biodiversity[c] : null

    const cover = world.canopyCover[c]
    const occ = world.occupancy[c]
    const plant = occ >= 0 ? world.plants[occ] : null
    const species = plant && project ? project.species.find((s) => s.id === plant.speciesId) : null
    return { c, moist, ph, n, p, k, inv, fire, bio, cover, species: species?.name }
  }, [cov, project, selectedCell, world])

  return (
    <>
      <Canvas camera={{ position: [90, 90, 90], fov: 48, near: 0.1, far: 1000 }} shadows>
        <color attach="background" args={['#0f1513']} />
        <hemisphereLight intensity={0.55} color={'#cfe8dc'} groundColor={'#0b1410'} />
        <ambientLight intensity={0.45} />
        <directionalLight position={[85, 130, 55]} intensity={1.45} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
        <OrbitControlsR3F maxPolarAngle={Math.PI * 0.48} minDistance={40} maxDistance={420} />
        <Scene />
      </Canvas>

      <div className="hud">
        <div className="line">
          Giorno: <strong>{hud?.day ?? '—'}</strong> | Sensori: <strong>{sensors.length}</strong> | Overlay: <strong>{overlayMode}</strong>
        </div>
        {placingSensor && <div className="line">Modalita piazzamento sensore: <strong>{placingSensor.type}</strong> (clicca sul terreno)</div>}
        {cellInfo && (
          <div className="line" style={{ marginTop: 6 }}>
            Cella <strong>#{cellInfo.c}</strong> | umid <strong>{cellInfo.moist == null ? 'ND' : `${cellInfo.moist.toFixed(0)}%`}</strong> | pH{' '}
            <strong>{cellInfo.ph == null ? 'ND' : cellInfo.ph.toFixed(1)}</strong> | NPK{' '}
            <strong>
              {cellInfo.n == null ? 'ND' : cellInfo.n.toFixed(0)}/{cellInfo.p == null ? 'ND' : cellInfo.p.toFixed(0)}/{cellInfo.k == null ? 'ND' : cellInfo.k.toFixed(0)}
            </strong>{' '}
            | cover <strong>{(cellInfo.cover * 100).toFixed(0)}%</strong> | inv <strong>{cellInfo.inv == null ? 'ND' : `${(cellInfo.inv * 100).toFixed(0)}%`}</strong> | fire{' '}
            <strong>{cellInfo.fire == null ? 'ND' : `${(cellInfo.fire * 100).toFixed(0)}%`}</strong> | bio <strong>{cellInfo.bio == null ? 'ND' : `${(cellInfo.bio * 100).toFixed(0)}%`}</strong>
            {cellInfo.species ? ` | specie: ${cellInfo.species}` : ''}
          </div>
        )}
      </div>

      <div className="hint">Drag: orbita | Wheel: zoom | Click: seleziona cella | Sensori: usa tab "Sensori" e clicca in scena</div>
    </>
  )
}
