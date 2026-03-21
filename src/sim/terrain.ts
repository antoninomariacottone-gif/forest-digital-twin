import type { ProjectConfig, SoilType, World } from './types'
import { fbm2 } from './noise'
import { clamp01, hash2, lerp, mulberry32 } from './random'

const soilToIndex: Record<SoilType, number> = {
  sabbioso: 0,
  argilloso: 1,
  limoso: 2,
  roccioso: 3,
  misto: 4,
}

export function soilIndexToType(idx: number): SoilType {
  switch (idx) {
    case 0:
      return 'sabbioso'
    case 1:
      return 'argilloso'
    case 2:
      return 'limoso'
    case 3:
      return 'roccioso'
    default:
      return 'misto'
  }
}

export function createWorldFromProject(project: ProjectConfig, seed = 1337): World {
  const { terrain } = project
  const n = terrain.gridSize
  const worldSizeM = terrain.worldSizeM
  const cellSizeM = worldSizeM / n
  const size = n * n

  const world: World = {
    day: 0,
    seasonDay: 120,
    gridSize: n,
    worldSizeM,
    cellSizeM,
    altitudeM: new Float32Array(size),
    shade: new Float32Array(size),
    soilType: new Uint8Array(size),
    moisturePct: new Float32Array(size),
    ph: new Float32Array(size),
    n: new Float32Array(size),
    p: new Float32Array(size),
    k: new Float32Array(size),
    carbon: new Float32Array(size),
    invasive: new Float32Array(size),
    canopyCover: new Float32Array(size),
    biodiversity: new Float32Array(size),
    fireRisk: new Float32Array(size),
    degradedMask: new Uint8Array(size),
    occupancy: new Int32Array(size),
    plants: [],
  }
  world.occupancy.fill(-1)

  const rng = mulberry32(seed)
  const rough = terrain.roughness
  const patch = terrain.shadePatchiness

  const altMin = terrain.altitudeMinM
  const altMax = terrain.altitudeMaxM

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i
      const u = i / (n - 1)
      const v = j / (n - 1)

      const hn = fbm2(u * 2.2, v * 2.2, seed + 10, 5)
      const hm = fbm2(u * 6.5, v * 6.5, seed + 33, 3)
      const h = lerp(hn, hm, rough)
      world.altitudeM[idx] = lerp(altMin, altMax, h)

      const shadeBase = fbm2(u * 3.0, v * 3.0, seed + 77, 4)
      world.shade[idx] = clamp01(lerp(0.1, 0.9, shadeBase) * lerp(0.5, 1.15, patch))

      let st: SoilType = terrain.baseSoil
      if (terrain.baseSoil === 'misto') {
        const r = fbm2(u * 1.6, v * 1.6, seed + 91, 3)
        if (r < 0.22) st = 'sabbioso'
        else if (r < 0.45) st = 'limoso'
        else if (r < 0.7) st = 'argilloso'
        else st = 'roccioso'
      }
      world.soilType[idx] = soilToIndex[st] ?? 4

      const elevFactor = 1 - clamp01((world.altitudeM[idx] - altMin) / Math.max(1, altMax - altMin))
      const moistNoise = fbm2(u * 4.2, v * 4.2, seed + 120, 4)
      const stMoistBias = st === 'argilloso' ? 0.12 : st === 'sabbioso' ? -0.12 : st === 'roccioso' ? -0.2 : 0
      const moisture = terrain.meanMoisturePct * (0.75 + 0.6 * moistNoise) * (0.75 + 0.55 * elevFactor) * (1 + stMoistBias)
      world.moisturePct[idx] = Math.min(100, Math.max(0, moisture))

      const phNoise = fbm2(u * 3.0, v * 3.0, seed + 222, 3)
      const stPhBias = st === 'roccioso' ? 0.4 : st === 'sabbioso' ? -0.15 : 0
      world.ph[idx] = Math.min(9, Math.max(4, terrain.ph + (phNoise - 0.5) * 0.8 + stPhBias))

      const nNoise = fbm2(u * 5.1, v * 5.1, seed + 301, 4)
      const pNoise = fbm2(u * 5.1, v * 5.1, seed + 302, 4)
      const kNoise = fbm2(u * 5.1, v * 5.1, seed + 303, 4)

      world.n[idx] = Math.max(0, terrain.nutrients.n * (0.7 + 0.8 * nNoise))
      world.p[idx] = Math.max(0, terrain.nutrients.p * (0.7 + 0.8 * pNoise))
      world.k[idx] = Math.max(0, terrain.nutrients.k * (0.7 + 0.8 * kNoise))

      const carbonBase = 6 + 18 * (world.moisturePct[idx] / 100) * (0.55 + 0.55 * elevFactor)
      world.carbon[idx] = carbonBase

      // initial invasives more likely in edge and flatter lower-altitude zones
      const edge = Math.min(u, 1 - u, v, 1 - v)
      const edgeFactor = clamp01(1 - edge * 4)
      world.invasive[idx] = clamp01((0.18 + 0.6 * (1 - elevFactor) + 0.25 * edgeFactor) * (0.25 + 0.9 * rng()))
    }
  }

  // Degraded patch: a couple of blobs where canopy is near zero initially.
  const degradedCenters = [
    { u: 0.26 + 0.08 * rng(), v: 0.34 + 0.08 * rng() },
    { u: 0.68 + 0.08 * rng(), v: 0.62 + 0.08 * rng() },
  ]

  for (const c of degradedCenters) {
    const cx = Math.floor(c.u * (n - 1))
    const cy = Math.floor(c.v * (n - 1))
    const rad = Math.floor(n * (0.12 + 0.06 * rng()))
    for (let y = Math.max(0, cy - rad); y <= Math.min(n - 1, cy + rad); y++) {
      for (let x = Math.max(0, cx - rad); x <= Math.min(n - 1, cx + rad); x++) {
        const dx = x - cx
        const dy = y - cy
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d > rad) continue
        const idx = y * n + x
        const t = 1 - d / Math.max(1, rad)
        world.degradedMask[idx] = 1
        world.moisturePct[idx] = Math.max(0, world.moisturePct[idx] * lerp(0.55, 0.92, t))
        world.n[idx] *= lerp(0.55, 0.9, t)
        world.p[idx] *= lerp(0.62, 0.95, t)
        world.k[idx] *= lerp(0.62, 0.95, t)
        world.invasive[idx] = clamp01(world.invasive[idx] + 0.3 * t)
      }
    }
  }

  // Seed sources: sprinkle a small number of mature plants later (engine will grow them quickly to maturity proxy).
  // We don’t instantiate them here; store handles it after species are loaded so we can pick ids.

  return world
}

export function worldXZToCell(world: World, xM: number, zM: number) {
  const n = world.gridSize
  const half = world.worldSizeM / 2
  const ux = (xM + half) / world.worldSizeM
  const uz = (zM + half) / world.worldSizeM
  const i = Math.min(n - 1, Math.max(0, Math.floor(ux * n)))
  const j = Math.min(n - 1, Math.max(0, Math.floor(uz * n)))
  return j * n + i
}

export function cellToWorldXZ(world: World, cell: number) {
  const n = world.gridSize
  const i = cell % n
  const j = Math.floor(cell / n)
  const half = world.worldSizeM / 2
  const x = (i + 0.5) * world.cellSizeM - half
  const z = (j + 0.5) * world.cellSizeM - half
  return { x, z }
}

export function neighborCells(world: World, cell: number) {
  const n = world.gridSize
  const i = cell % n
  const j = Math.floor(cell / n)
  const out: number[] = []
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      if (di === 0 && dj === 0) continue
      const ii = i + di
      const jj = j + dj
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue
      out.push(jj * n + ii)
    }
  }
  return out
}

export function cellRandom(world: World, cell: number, seed: number) {
  const n = world.gridSize
  const i = cell % n
  const j = Math.floor(cell / n)
  return hash2(i, j, seed)
}

