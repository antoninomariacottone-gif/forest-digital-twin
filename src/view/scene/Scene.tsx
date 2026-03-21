import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { type ThreeEvent, useFrame } from '@react-three/fiber'
import { useSimStore } from '../../state/store'
import { cellToWorldXZ, worldXZToCell } from '../../sim/terrain'
import { COVER_BIO, COVER_CLIMATE, COVER_SOIL } from '../../sim/sensors'
import { computeCoverageQuality } from '../../sim/observe'
import { sampleAltitude } from './worldMath'

const tmpM = new THREE.Matrix4()
const tmpV = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpS = new THREE.Vector3()
const tmpColor = new THREE.Color()

export function Scene() {
  const world = useSimStore((s) => s.world)
  const worldVersion = useSimStore((s) => s.worldVersion)
  const project = useSimStore((s) => s.project)
  const sensors = useSimStore((s) => s.sensors)
  const overlayMode = useSimStore((s) => s.overlayMode)
  const showRoots = useSimStore((s) => s.showRoots)
  const placingSensor = useSimStore((s) => s.placingSensor)
  const placeSensorAt = useSimStore((s) => s.placeSensorAt)
  const setSelectedCell = useSimStore((s) => s.setSelectedCell)

  const terrain = useMemo(() => {
    if (!world) return null
    let minAlt = Infinity
    for (let i = 0; i < world.altitudeM.length; i++) minAlt = Math.min(minAlt, world.altitudeM[i])
    const yScale = 0.12
    const n = world.gridSize
    const geom = new THREE.PlaneGeometry(world.worldSizeM, world.worldSizeM, n - 1, n - 1)
    geom.rotateX(-Math.PI / 2)
    const pos = geom.attributes.position as THREE.BufferAttribute
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i
        const y = (world.altitudeM[idx] - minAlt) * yScale
        pos.setY(idx, y)
      }
    }
    pos.needsUpdate = true
    geom.computeVertexNormals()

    const mat = new THREE.MeshStandardMaterial({
      color: '#2c4a3c',
      roughness: 1,
      metalness: 0,
      emissive: new THREE.Color('#14241d'),
      emissiveIntensity: 0.28,
    })
    return { geom, mat, minAlt, yScale }
  }, [world])

  const overlay = useMemo(() => {
    if (!world) return null
    const tex = new THREE.DataTexture(new Uint8Array(world.gridSize * world.gridSize * 4), world.gridSize, world.gridSize, THREE.RGBAFormat)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.needsUpdate = true

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 1,
      depthTest: false, // ensure overlay is always visible (no z-fighting with the terrain)
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    return { tex, mat }
  }, [world])

  useEffect(() => {
    if (!world || !overlay) return
    const cov = computeCoverageQuality(world, sensors)
    const img = overlay.tex.image.data as Uint8Array
    const nCells = world.gridSize * world.gridSize

    // Dynamic scaling per-overlay using only observable (covered) cells.
    // This prevents "flat" overlays when storage ranges are narrow and also respects the "no data without sensors" rule.
    const mode = overlayMode
    const requires =
      mode === 'moisture' || mode === 'nutrients_n' || mode === 'nutrients_p' || mode === 'nutrients_k' || mode === 'carbon' || mode === 'ph'
        ? COVER_SOIL
        : mode === 'biodiversity' || mode === 'invasive'
          ? COVER_BIO
          : mode === 'fire'
            ? COVER_CLIMATE | COVER_BIO
            : 0

    let vMin = Infinity
    let vMax = -Infinity
    if (mode !== 'none' && mode !== 'coverage' && requires) {
      for (let c = 0; c < nCells; c++) {
        if ((cov.mask[c] & requires) !== requires) continue
        const v = rawOverlayValue(world, mode, c)
        if (!Number.isFinite(v)) continue
        vMin = Math.min(vMin, v)
        vMax = Math.max(vMax, v)
      }
      if (!Number.isFinite(vMin) || !Number.isFinite(vMax)) {
        vMin = 0
        vMax = 1
      }
      if (Math.abs(vMax - vMin) < 1e-6) {
        vMin -= 1
        vMax += 1
      }

      // Keep sensible fixed domains where it improves readability.
      if (mode === 'moisture') {
        vMin = 0
        vMax = 100
      } else if (mode === 'ph') {
        vMin = 4
        vMax = 9
      } else if (mode === 'biodiversity' || mode === 'invasive' || mode === 'fire') {
        vMin = 0
        vMax = 1
      }
    }

    for (let c = 0; c < nCells; c++) {
      const base = c * 4
      const v = valueForOverlay(world, cov, overlayMode, c, vMin, vMax)
      img[base + 0] = v.r
      img[base + 1] = v.g
      img[base + 2] = v.b
      img[base + 3] = v.a
    }
    overlay.tex.needsUpdate = true
  }, [overlay, overlayMode, sensors, world, worldVersion])

  const trunksRef = useRef<THREE.InstancedMesh>(null)
  const canopyBroadARef = useRef<THREE.InstancedMesh>(null)
  const canopyBroadBRef = useRef<THREE.InstancedMesh>(null)
  const canopyBroadCRef = useRef<THREE.InstancedMesh>(null)
  const canopyConiferARef = useRef<THREE.InstancedMesh>(null)
  const canopyConiferBRef = useRef<THREE.InstancedMesh>(null)
  const canopyShrubRef = useRef<THREE.InstancedMesh>(null)
  const rootsTapRef = useRef<THREE.InstancedMesh>(null)
  const rootsLatRef = useRef<THREE.InstancedMesh>(null)

  const plantCap = 12000

  useEffect(() => {
    if (!world || !project) return
    const live = world.plants.filter((p) => p.alive)
    const trunks = trunksRef.current
    const broadA = canopyBroadARef.current
    const broadB = canopyBroadBRef.current
    const broadC = canopyBroadCRef.current
    const coniferA = canopyConiferARef.current
    const coniferB = canopyConiferBRef.current
    const shrub = canopyShrubRef.current
    const rootsTap = rootsTapRef.current
    const rootsLat = rootsLatRef.current
    if (!trunks || !broadA || !broadB || !broadC || !coniferA || !coniferB || !shrub) return

    const count = Math.min(plantCap, live.length)
    const byId = new Map(project.species.map((s) => [s.id, s]))
    let bi = 0
    let ci = 0
    let si = 0
    for (let i = 0; i < count; i++) {
      const p = live[i]
      const pos = cellToWorldXZ(world, p.cell)
      const y = (sampleAltitude(world, pos.x, pos.z) - terrain!.minAlt) * terrain!.yScale

      // trunk
      // Use meters directly (unit geometry scaled to meters).
      tmpV.set(pos.x, y + Math.max(0.08, p.heightM) * 0.5, pos.z)
      tmpQ.setFromEuler(new THREE.Euler(0, (p.id % 13) * 0.33, 0))
      tmpS.set(Math.max(0.015, p.trunkRadiusM), Math.max(0.08, p.heightM), Math.max(0.015, p.trunkRadiusM))
      tmpM.compose(tmpV, tmpQ, tmpS)
      trunks.setMatrixAt(i, tmpM)
      const sp = byId.get(p.speciesId)
      tmpColor.set(sp?.color.trunk ?? '#5b4636')
      trunks.setColorAt(i, tmpColor)

      // canopy (pick geometry based on species form)
      const form = sp?.form ?? 'latifoglia'
      const canopyY = y + Math.max(0.12, p.heightM) * 0.78
      const wobble = 0.92 + ((p.id % 7) / 6) * 0.18
      tmpColor.set(sp?.color.canopy ?? '#2e8b57')
      if (form === 'conifera') {
        // Two-layer conifer for a more tree-like silhouette.
        tmpV.set(pos.x, canopyY, pos.z)
        tmpS.set(Math.max(0.06, p.canopyRadiusM) * 0.55 * wobble, Math.max(0.06, p.canopyRadiusM) * 1.25 * wobble, Math.max(0.06, p.canopyRadiusM) * 0.55 * wobble)
        tmpM.compose(tmpV, tmpQ, tmpS)
        coniferA.setMatrixAt(ci, tmpM)
        coniferA.setColorAt(ci, tmpColor)

        tmpV.set(pos.x, canopyY + Math.max(0.06, p.canopyRadiusM) * 0.35, pos.z)
        tmpS.set(Math.max(0.06, p.canopyRadiusM) * 0.4 * wobble, Math.max(0.06, p.canopyRadiusM) * 0.95 * wobble, Math.max(0.06, p.canopyRadiusM) * 0.4 * wobble)
        tmpM.compose(tmpV, tmpQ, tmpS)
        coniferB.setMatrixAt(ci, tmpM)
        coniferB.setColorAt(ci, tmpColor)
        ci++
      } else if (form === 'arbusto') {
        tmpV.set(pos.x, y + Math.max(0.08, p.heightM) * 0.45, pos.z)
        tmpS.set(Math.max(0.05, p.canopyRadiusM) * 0.75 * wobble, Math.max(0.05, p.canopyRadiusM) * 0.5 * wobble, Math.max(0.05, p.canopyRadiusM) * 0.75 * wobble)
        tmpM.compose(tmpV, tmpQ, tmpS)
        shrub.setMatrixAt(si, tmpM)
        shrub.setColorAt(si, tmpColor)
        si++
      } else {
        // Broadleaf: multi-lobe canopy to avoid "ball on a stick".
        const off = ((p.id % 9) - 4) / 4
        const off2 = (((p.id * 7) % 9) - 4) / 4

        tmpV.set(pos.x, canopyY, pos.z)
        tmpS.set(Math.max(0.06, p.canopyRadiusM) * 0.85 * wobble, Math.max(0.06, p.canopyRadiusM) * 0.7 * wobble, Math.max(0.06, p.canopyRadiusM) * 0.85 * wobble)
        tmpM.compose(tmpV, tmpQ, tmpS)
        broadA.setMatrixAt(bi, tmpM)
        broadA.setColorAt(bi, tmpColor)

        const cr = Math.max(0.06, p.canopyRadiusM)
        tmpV.set(pos.x + off * cr * 0.22, canopyY + cr * 0.12, pos.z + off2 * cr * 0.22)
        tmpS.set(cr * 0.7 * wobble, cr * 0.55 * wobble, cr * 0.7 * wobble)
        tmpM.compose(tmpV, tmpQ, tmpS)
        broadB.setMatrixAt(bi, tmpM)
        broadB.setColorAt(bi, tmpColor)

        tmpV.set(pos.x - off2 * cr * 0.18, canopyY - cr * 0.1, pos.z + off * cr * 0.18)
        tmpS.set(cr * 0.62 * wobble, cr * 0.5 * wobble, cr * 0.62 * wobble)
        tmpM.compose(tmpV, tmpQ, tmpS)
        broadC.setMatrixAt(bi, tmpM)
        broadC.setColorAt(bi, tmpColor)
        bi++
      }

      if (rootsTap && rootsLat) {
        // Roots rendered as an x-ray proxy (taproot + 4 laterals).
        const depth = Math.max(0.25, p.rootDepthM)
        const spread = Math.max(0.25, Math.min(p.canopyRadiusM * 0.6, 2.4))

        // Taproot (downward)
        tmpV.set(pos.x, y - depth * 0.5, pos.z)
        tmpS.set(Math.max(0.12, p.trunkRadiusM * 2.6), depth, Math.max(0.12, p.trunkRadiusM * 2.6))
        tmpM.compose(tmpV, tmpQ, tmpS)
        rootsTap.setMatrixAt(i, tmpM)
        tmpColor.set('#a58b6a')
        rootsTap.setColorAt(i, tmpColor)

        // Laterals
        const baseIdx = i * 4
        for (let k = 0; k < 4; k++) {
          const ang = ((k / 4) * Math.PI * 2 + (p.id % 13) * 0.11) % (Math.PI * 2)
          // place a bit below soil and tilt downward
          tmpV.set(pos.x + Math.cos(ang) * spread * 0.35, y - depth * 0.25, pos.z + Math.sin(ang) * spread * 0.35)
          tmpQ.setFromEuler(new THREE.Euler(0.55, ang, 0))
          tmpS.set(Math.max(0.06, p.trunkRadiusM * 1.2), Math.max(0.25, spread * 0.65), Math.max(0.06, p.trunkRadiusM * 1.2))
          tmpM.compose(tmpV, tmpQ, tmpS)
          rootsLat.setMatrixAt(baseIdx + k, tmpM)
          rootsLat.setColorAt(baseIdx + k, tmpColor)
        }
      }
    }

    trunks.count = count
    broadA.count = bi
    broadB.count = bi
    broadC.count = bi
    coniferA.count = ci
    coniferB.count = ci
    shrub.count = si
    if (rootsTap) rootsTap.count = count
    if (rootsLat) rootsLat.count = count * 4

    trunks.instanceMatrix.needsUpdate = true
    broadA.instanceMatrix.needsUpdate = true
    broadB.instanceMatrix.needsUpdate = true
    broadC.instanceMatrix.needsUpdate = true
    coniferA.instanceMatrix.needsUpdate = true
    coniferB.instanceMatrix.needsUpdate = true
    shrub.instanceMatrix.needsUpdate = true
    trunks.instanceColor!.needsUpdate = true
    broadA.instanceColor!.needsUpdate = true
    broadB.instanceColor!.needsUpdate = true
    broadC.instanceColor!.needsUpdate = true
    coniferA.instanceColor!.needsUpdate = true
    coniferB.instanceColor!.needsUpdate = true
    shrub.instanceColor!.needsUpdate = true
    if (rootsTap) {
      rootsTap.instanceMatrix.needsUpdate = true
      rootsTap.instanceColor!.needsUpdate = true
    }
    if (rootsLat) {
      rootsLat.instanceMatrix.needsUpdate = true
      rootsLat.instanceColor!.needsUpdate = true
    }
  }, [project, terrain, world, worldVersion, showRoots])

  useFrame(() => {
    // Keep overlay slightly above terrain even when altitude changes.
    if (!world) return
  })

  if (!world || !terrain || !overlay) return null

  return (
    <group>
      <mesh
        geometry={terrain.geom}
        material={terrain.mat}
        receiveShadow
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          const p = e.point
          if (placingSensor) {
            placeSensorAt({ x: p.x, z: p.z })
            return
          }
          const c = worldXZToCell(world, p.x, p.z)
          setSelectedCell(c)
        }}
      />

      {/* Overlay uses the same terrain geometry so it follows topography. */}
      <mesh geometry={terrain.geom} material={overlay.mat} renderOrder={2} frustumCulled={false} />

      <instancedMesh ref={trunksRef} args={[undefined as any, undefined as any, plantCap]} castShadow receiveShadow>
        {/* Tapered trunk for a more tree-like look. */}
        <cylinderGeometry args={[0.55, 1, 1, 18, 1]} />
        <meshStandardMaterial roughness={1} metalness={0} vertexColors />
      </instancedMesh>

      <instancedMesh ref={canopyBroadARef} args={[undefined as any, undefined as any, plantCap]} castShadow receiveShadow>
        {/* Broadleaf canopy: 3-lobe volume */}
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial roughness={0.95} metalness={0} vertexColors />
      </instancedMesh>
      <instancedMesh ref={canopyBroadBRef} args={[undefined as any, undefined as any, plantCap]} castShadow receiveShadow>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial roughness={0.95} metalness={0} vertexColors />
      </instancedMesh>
      <instancedMesh ref={canopyBroadCRef} args={[undefined as any, undefined as any, plantCap]} castShadow receiveShadow>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial roughness={0.95} metalness={0} vertexColors />
      </instancedMesh>

      <instancedMesh ref={canopyConiferARef} args={[undefined as any, undefined as any, plantCap]} castShadow receiveShadow>
        <coneGeometry args={[1, 1.8, 16, 2]} />
        <meshStandardMaterial roughness={0.95} metalness={0} vertexColors />
      </instancedMesh>
      <instancedMesh ref={canopyConiferBRef} args={[undefined as any, undefined as any, plantCap]} castShadow receiveShadow>
        <coneGeometry args={[1, 1.6, 16, 2]} />
        <meshStandardMaterial roughness={0.96} metalness={0} vertexColors />
      </instancedMesh>
      <instancedMesh ref={canopyShrubRef} args={[undefined as any, undefined as any, plantCap]} castShadow receiveShadow>
        <sphereGeometry args={[1, 14, 10]} />
        <meshStandardMaterial roughness={0.98} metalness={0} vertexColors />
      </instancedMesh>

      {showRoots && (
        <>
          <instancedMesh ref={rootsTapRef} args={[undefined as any, undefined as any, plantCap]} castShadow={false} receiveShadow={false}>
          {/* Root proxy: cone downward to avoid "cylinder collar" look. */}
          <coneGeometry args={[1, 1.8, 18, 1]} />
          <meshStandardMaterial
            roughness={1}
            metalness={0}
            transparent
            opacity={0.55}
            vertexColors
            depthWrite={false}
            depthTest={false}
            emissive={new THREE.Color('#5a3e26')}
            emissiveIntensity={0.42}
          />
          </instancedMesh>

          <instancedMesh ref={rootsLatRef} args={[undefined as any, undefined as any, plantCap * 4]} castShadow={false} receiveShadow={false}>
            <cylinderGeometry args={[0.8, 1, 1, 14, 1]} />
            <meshStandardMaterial
              roughness={1}
              metalness={0}
              transparent
              opacity={0.4}
              vertexColors
              depthWrite={false}
              depthTest={false}
              emissive={new THREE.Color('#5a3e26')}
              emissiveIntensity={0.3}
            />
          </instancedMesh>
        </>
      )}

      <Sensors />
    </group>
  )
}

function Sensors() {
  const world = useSimStore((s) => s.world)
  const sensors = useSimStore((s) => s.sensors)
  if (!world) return null
  let minAlt = Infinity
  for (let i = 0; i < world.altitudeM.length; i++) minAlt = Math.min(minAlt, world.altitudeM[i])
  const yScale = 0.12
  return (
    <group>
      {sensors.map((s) => {
        const y = (sampleAltitude(world, s.position.x, s.position.z) - minAlt) * yScale
        const color = s.type === 'suolo' ? '#63d2a3' : s.type === 'clima' ? '#f5c66a' : '#7aa7ff'
        return (
          <group key={s.id} position={[s.position.x, y + 1.0, s.position.z]}>
            <mesh>
              <sphereGeometry args={[0.7, 18, 18]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[Math.max(1, s.radiusM), Math.max(1, s.radiusM) + 0.35, 48]} />
              <meshBasicMaterial color={color} transparent opacity={0.3} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

function valueForOverlay(world: any, cov: ReturnType<typeof computeCoverageQuality>, mode: string, cell: number, vMin: number, vMax: number) {
  // Unknown where no required sensors: gray
  // Keep a faint "no data" mask so the user can see the boundary of sensor coverage.
  const missing = { r: 18, g: 18, b: 18, a: 95 }
  const none = { r: 0, g: 0, b: 0, a: 0 }

  if (mode === 'none') return none
  if (mode === 'coverage') {
    if (cov.mask[cell] === 0) return { r: 255, g: 90, b: 90, a: 150 }
    const g = Math.min(255, 90 + cov.mask[cell] * 45)
    return { r: 80, g, b: 120, a: 120 }
  }

  const requires =
    mode === 'moisture' || mode === 'nutrients_n' || mode === 'nutrients_p' || mode === 'nutrients_k' || mode === 'carbon' || mode === 'ph'
      ? COVER_SOIL
      : mode === 'biodiversity' || mode === 'invasive'
        ? COVER_BIO
        : mode === 'fire'
          ? COVER_CLIMATE | COVER_BIO
          : 0
  if (requires && (cov.mask[cell] & requires) !== requires) return missing

  const raw = rawOverlayValue(world, mode, cell)
  let t = (raw - vMin) / Math.max(1e-6, vMax - vMin)
  t = Math.min(1, Math.max(0, t))

  // Color rule:
  // - substances and "good" indices: low=red, high=green
  // - risks: low=green, high=red
  const isRisk = mode === 'fire' || mode === 'invasive'
  const tt = isRisk ? t : 1 - t
  return redGreen(tt)
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function redGreen(t: number) {
  // t=0 -> green, t=1 -> red
  const r = Math.round(lerp(70, 240, t))
  const g = Math.round(lerp(210, 70, t))
  const b = Math.round(lerp(80, 60, t))
  return { r, g, b, a: 165 }
}

function rawOverlayValue(world: any, mode: string, cell: number) {
  if (mode === 'moisture') return world.moisturePct[cell] ?? 0
  if (mode === 'nutrients_n') return world.n[cell] ?? 0
  if (mode === 'nutrients_p') return world.p[cell] ?? 0
  if (mode === 'nutrients_k') return world.k[cell] ?? 0
  if (mode === 'carbon') return world.carbon[cell] ?? 0
  if (mode === 'ph') return world.ph[cell] ?? 6.5
  if (mode === 'biodiversity') return world.biodiversity[cell] ?? 0
  if (mode === 'invasive') return world.invasive[cell] ?? 0
  if (mode === 'fire') return world.fireRisk[cell] ?? 0
  return 0
}
