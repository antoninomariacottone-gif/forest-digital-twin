import type { AiSuggestion, Intervention, ProjectConfig, SensorConfig, SensorType, World } from './types'
import { clamp01, lerp, mulberry32, smoothstep } from './random'
import { cellToWorldXZ, neighborCells } from './terrain'
import { computeCoverage, COVER_BIO, COVER_CLIMATE, COVER_SOIL, hasCoverage, quantizeSensorCost, worldClampPosition } from './sensors'
import { estimatePlantBiomassKgC } from './engine'

export type SensorPlanSuggestion = Extract<AiSuggestion, { kind: 'sensor_plan' }>

function seasonalTemp(world: World, mean: number, amp: number) {
  const seasonT = Math.sin(((world.seasonDay - 80) / 365) * Math.PI * 2)
  return mean + amp * seasonT
}

export function pickBestSpeciesForCell(world: World, project: ProjectConfig, cell: number) {
  let best: { id: string; score: number } | null = null
  const tempC = seasonalTemp(world, project.terrain.meanTempC, project.terrain.seasonalTempAmpC)
  const moist = world.moisturePct[cell]
  const ph = world.ph[cell]
  const shade = world.shade[cell]
  const n = world.n[cell]
  const p = world.p[cell]
  const k = world.k[cell]

  for (const s of project.species) {
    const phSuit = smoothstep(s.tolerance.phMin, s.tolerance.phMin + 0.7, ph) * (1 - smoothstep(s.tolerance.phMax - 0.7, s.tolerance.phMax, ph))
    const tempSuit =
      smoothstep(s.tolerance.tempMinC, s.tolerance.tempMinC + 9, tempC) * (1 - smoothstep(s.tolerance.tempMaxC - 9, s.tolerance.tempMaxC, tempC))
    const moistSuit = smoothstep(s.seed.minMoisturePct * 0.65, s.seed.minMoisturePct + 14, moist)
    const shadeSuit = lerp(1 - s.shadePreference, 1, shade)
    const nutrSuit = clamp01((n / 100) * 0.36 + (p / 100) * 0.32 + (k / 100) * 0.32)
    const score = clamp01(phSuit * 0.33 + tempSuit * 0.28 + moistSuit * 0.26 + shadeSuit * 0.08 + nutrSuit * 0.05)
    if (!best || score > best.score) best = { id: s.id, score }
  }
  return best
}

export function suggestSensorPlacement(world: World, sensors: SensorConfig[], budgetRemaining: number, seed: number): SensorPlanSuggestion | null {
  const rng = mulberry32(seed ^ (Math.floor(world.day) + 1))
  const n = world.gridSize
  const nCells = n * n

  const covMask = computeCoverage(world, sensors) // per-cell bitmask

  // Information need (no cheating):
  // - terrain heterogeneity always known (altitude + shade gradients)
  // - hotspots only where already observed by sensors
  const needSoil = new Float32Array(nCells)
  const needBio = new Float32Array(nCells)
  const needClimate = new Float32Array(nCells)
  for (let c = 0; c < nCells; c++) {
    const neigh = neighborCells(world, c)
    let hetero = 0
    for (const nc of neigh) {
      hetero += Math.abs(world.altitudeM[c] - world.altitudeM[nc]) * 0.003
      hetero += Math.abs(world.shade[c] - world.shade[nc]) * 0.55
    }
    hetero = clamp01(hetero * 0.35)

    const degraded = world.degradedMask[c] ? 1 : 0
    const canopy = clamp01(world.canopyCover[c] ?? 0)

    const invHot = (covMask[c] & COVER_BIO) === COVER_BIO ? clamp01(world.invasive[c] ?? 0) : 0
    const fireHot =
      (covMask[c] & (COVER_BIO | COVER_CLIMATE)) === (COVER_BIO | COVER_CLIMATE) ? clamp01(world.fireRisk[c] ?? 0) : 0

    needSoil[c] = clamp01(0.5 * hetero + 0.45 * degraded + 0.25 * (1 - canopy))
    needBio[c] = clamp01(0.4 * hetero + 0.25 * degraded + 0.55 * invHot + 0.15 * (1 - canopy))
    needClimate[c] = clamp01(0.55 * hetero + 0.6 * fireHot + 0.15 * (1 - canopy))
  }

  const planned: Omit<SensorConfig, 'id'>[] = []
  let totalCost = 0
  const wantClimate = sensors.every((s) => s.type !== 'clima')
  const targetCount = Math.min(22, Math.max(6, Math.floor(nCells / 420)))

  const plannedCov = new Uint8Array(covMask)

  for (let k = 0; k < targetCount; k++) {
    let type: SensorType
    if (k === 0 && wantClimate) type = 'clima'
    else {
      const uncoveredSoil = sumUncoveredNeed(plannedCov, needSoil, COVER_SOIL)
      const uncoveredBio = sumUncoveredNeed(plannedCov, needBio, COVER_BIO)
      const uncoveredClimate = sumUncoveredNeed(plannedCov, needClimate, COVER_CLIMATE)
      if (uncoveredSoil >= uncoveredBio && uncoveredSoil >= uncoveredClimate) type = 'suolo'
      else if (uncoveredBio >= uncoveredClimate) type = 'biodiversita'
      else type = 'clima'
    }

    const precision = type === 'biodiversita' ? 0.8 : 0.7
    const radiusM = type === 'clima' ? world.worldSizeM * 0.5 : type === 'suolo' ? world.worldSizeM * 0.14 : world.worldSizeM * 0.18
    const cost = quantizeSensorCost(type, precision, radiusM)
    if (totalCost + cost > budgetRemaining) break

    let bestCell = -1
    let bestScore = -1

    if (type === 'clima') {
      // Climate stations are broad: pick from a few "good" anchors.
      const candidates = [
        worldXZToCellApprox(world, 0, 0),
        worldXZToCellApprox(world, -world.worldSizeM * 0.33, -world.worldSizeM * 0.33),
        worldXZToCellApprox(world, world.worldSizeM * 0.33, world.worldSizeM * 0.33),
      ]
      for (const c of candidates) {
        const score = coverageGainScore(world, plannedCov, type, c, needClimate, sensors, planned)
        if (score > bestScore) {
          bestScore = score
          bestCell = c
        }
      }
    } else {
      const need = type === 'suolo' ? needSoil : needBio
      for (let attempt = 0; attempt < 1400; attempt++) {
        const c = Math.floor(rng() * nCells)
        const score = coverageGainScore(world, plannedCov, type, c, need, sensors, planned)
        if (score > bestScore) {
          bestScore = score
          bestCell = c
        }
      }
    }

    if (bestCell < 0 || bestScore <= 0.0001) continue
    const pos = cellToWorldXZ(world, bestCell)
    const plannedSensor: Omit<SensorConfig, 'id'> = {
      type,
      position: worldClampPosition(world, pos),
      radiusM,
      precision,
      cost,
    }
    planned.push(plannedSensor)
    totalCost += cost

    // Update planned coverage mask so later picks "see" this sensor.
    const maskBit = type === 'suolo' ? COVER_SOIL : type === 'clima' ? COVER_CLIMATE : COVER_BIO
    const radCells = Math.max(1, Math.floor(radiusM / world.cellSizeM))
    const half = world.worldSizeM / 2
    const cx = Math.floor(((plannedSensor.position.x + half) / world.worldSizeM) * n)
    const cz = Math.floor(((plannedSensor.position.z + half) / world.worldSizeM) * n)
    for (let dz = -radCells; dz <= radCells; dz++) {
      for (let dx = -radCells; dx <= radCells; dx++) {
        const x = cx + dx
        const z = cz + dz
        if (x < 0 || z < 0 || x >= n || z >= n) continue
        const d2 = dx * dx + dz * dz
        if (d2 > radCells * radCells) continue
        plannedCov[z * n + x] |= maskBit
      }
    }
  }

  if (planned.length === 0) return null
  return { id: `ai_sensor_${Math.floor(world.day)}_${seed}`, kind: 'sensor_plan', sensors: planned, totalCost, createdAtDay: Math.floor(world.day) }
}

export function suggestInterventions(
  world: World,
  project: ProjectConfig,
  sensors: SensorConfig[],
  budgetRemaining: number,
  seed: number,
): AiSuggestion[] {
  const rng = mulberry32(seed ^ 0xabcddcba ^ Math.floor(world.day))
  const cov = computeCoverage(world, sensors)
  const nCells = world.gridSize * world.gridSize
  const suggestions: AiSuggestion[] = []

  // 1) Drone seeding on observable empty cells. Choose best species per cell, group by species into a few missions.
  type SeedPick = { cell: number; speciesId: string; score: number }
  const picks: SeedPick[] = []
  for (let c = 0; c < nCells; c++) {
    if (!hasCoverage(cov, c, COVER_SOIL | COVER_CLIMATE)) continue
    if (world.occupancy[c] !== -1) continue
    if ((world.canopyCover[c] ?? 0) > 0.05) continue
    if ((world.invasive[c] ?? 0) > 0.75) continue

    const degraded = world.degradedMask[c] ? 1 : 0
    const moist = world.moisturePct[c] ?? 0
    if (moist < 16) continue

    // Prefer degraded patches, but also allow "bare-but-not-degraded" to regen naturally.
    const priority = 0.55 * degraded + 0.35 * (1 - clamp01(world.canopyCover[c] ?? 0)) + 0.1 * rng()
    if (priority < 0.22) continue

    const best = pickBestSpeciesForCell(world, project, c)
    if (!best || best.score < 0.46) continue
    picks.push({ cell: c, speciesId: best.id, score: best.score })
  }

  if (picks.length > 0) {
    picks.sort((a, b) => b.score - a.score)
    const selected = picks.slice(0, Math.min(260, picks.length))

    const bySpecies = new Map<string, { cells: number[]; scoreSum: number }>()
    for (const p of selected) {
      const g = bySpecies.get(p.speciesId) ?? { cells: [], scoreSum: 0 }
      g.cells.push(p.cell)
      g.scoreSum += p.score
      bySpecies.set(p.speciesId, g)
    }

    const groups = [...bySpecies.entries()]
      .map(([speciesId, g]) => ({ speciesId, cells: g.cells, scoreSum: g.scoreSum }))
      .sort((a, b) => b.scoreSum - a.scoreSum)
      .slice(0, 3)

    for (const g of groups) {
      const cells = g.cells.slice(0, 160)
      const cost = Math.round(cells.length * 55)
      if (cells.length === 0 || cost > budgetRemaining) continue
      const intervention: Omit<Intervention, 'id'> = {
        type: 'semina_droni',
        createdAtDay: Math.floor(world.day),
        approved: false,
        rejected: false,
        cost,
        payload: { kind: 'seeding', cells, speciesId: g.speciesId },
      }
      suggestions.push({
        id: `ai_int_seed_${g.speciesId}_${Math.floor(world.day)}_${seed}`,
        kind: 'intervention',
        intervention,
        createdAtDay: Math.floor(world.day),
      })
      budgetRemaining -= cost
    }
  }

  // 2) Remove invasives in measured hot spots.
  const invCells: number[] = []
  for (let c = 0; c < nCells; c++) {
    if (!hasCoverage(cov, c, COVER_BIO)) continue
    if (world.invasive[c] < 0.75) continue
    if (world.canopyCover[c] > 0.35) continue
    if (rng() < 0.09) invCells.push(c)
  }
  if (invCells.length > 0) {
    const cost = Math.round(invCells.length * 80)
    if (cost <= budgetRemaining) {
      const intervention: Omit<Intervention, 'id'> = {
        type: 'rimozione_invasive',
        createdAtDay: Math.floor(world.day),
        approved: false,
        rejected: false,
        cost,
        payload: { kind: 'invasive_removal', cells: invCells },
      }
      suggestions.push({ id: `ai_int_inv_${Math.floor(world.day)}_${seed}`, kind: 'intervention', intervention, createdAtDay: Math.floor(world.day) })
      budgetRemaining -= cost
    }
  }

  // 3) Firebreak corridor: when fire risk is high and we have climate+bio coverage in the zone.
  const topFire = topCells(world.fireRisk, 12, cov, COVER_CLIMATE | COVER_BIO)
  if (topFire.length >= 2) {
    const a = cellToWorldXZ(world, topFire[0])
    const b = cellToWorldXZ(world, topFire[topFire.length - 1])
    const widthM = 6
    const dist = Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2)
    const cost = Math.round((dist / 10) * 200)
    if (cost <= budgetRemaining) {
      const intervention: Omit<Intervention, 'id'> = {
        type: 'corridoio_antincendio',
        createdAtDay: Math.floor(world.day),
        approved: false,
        rejected: false,
        cost,
        payload: { kind: 'firebreak', polyline: [a, b], widthM },
      }
      suggestions.push({ id: `ai_int_fire_${Math.floor(world.day)}_${seed}`, kind: 'intervention', intervention, createdAtDay: Math.floor(world.day) })
    }
  }

  return suggestions
}

function topCells(values: Float32Array, count: number, cov: Uint8Array, required: number) {
  const idxs: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (!hasCoverage(cov, i, required)) continue
    if (values[i] < 0.78) continue
    idxs.push(i)
  }
  idxs.sort((a, b) => values[b] - values[a])
  return idxs.slice(0, count)
}

export function applyIntervention(world: World, project: ProjectConfig, intervention: Intervention, seed: number) {
  const rng = mulberry32(seed ^ 0x1020304 ^ Math.floor(world.day))
  const p = intervention.payload

  if (p.kind === 'seeding') {
    for (const c of p.cells) {
      if (world.occupancy[c] !== -1) continue
      const best = project.species.find((s) => s.id === p.speciesId) ?? project.species[0]
      if (!best) continue
      // Seeds in soil (germination phase) rather than instant saplings.
      const id = world.plants.length
      world.plants.push({
        id,
        speciesId: best.id,
        cell: c,
        ageDays: -Math.max(1, best.germinationDays),
        heightM: 0.06,
        trunkRadiusM: 0.004,
        canopyRadiusM: 0.03,
        rootDepthM: 0.02,
        health: 0.48 + 0.14 * rng(),
        alive: true,
        lastSeedDay: -999,
      })
      world.occupancy[c] = id
      world.invasive[c] = Math.max(0, world.invasive[c] - 0.12)
    }
  } else if (p.kind === 'invasive_removal') {
    for (const c of p.cells) {
      world.invasive[c] = Math.max(0, world.invasive[c] - (0.55 + 0.25 * rng()))
    }
  } else if (p.kind === 'firebreak') {
    if (p.polyline.length < 2) return
    const a = p.polyline[0]
    const b = p.polyline[p.polyline.length - 1]
    const steps = Math.max(8, Math.floor(Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2) / world.cellSizeM))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const x = lerp(a.x, b.x, t)
      const z = lerp(a.z, b.z, t)
      const c = worldXZToCellApprox(world, x, z)
      const rad = Math.max(1, Math.floor((p.widthM * 0.6) / world.cellSizeM))
      paintDisk(world, c, rad, (cc) => {
        world.invasive[cc] *= 0.3
        world.canopyCover[cc] *= 0.7
      })
    }
  }
}

function worldXZToCellApprox(world: World, xM: number, zM: number) {
  const n = world.gridSize
  const half = world.worldSizeM / 2
  const ux = (xM + half) / world.worldSizeM
  const uz = (zM + half) / world.worldSizeM
  const i = Math.min(n - 1, Math.max(0, Math.floor(ux * n)))
  const j = Math.min(n - 1, Math.max(0, Math.floor(uz * n)))
  return j * n + i
}

function paintDisk(world: World, centerCell: number, radCells: number, fn: (c: number) => void) {
  const n = world.gridSize
  const ci = centerCell % n
  const cj = Math.floor(centerCell / n)
  for (let dz = -radCells; dz <= radCells; dz++) {
    for (let dx = -radCells; dx <= radCells; dx++) {
      if (dx * dx + dz * dz > radCells * radCells) continue
      const i = ci + dx
      const j = cj + dz
      if (i < 0 || j < 0 || i >= n || j >= n) continue
      fn(j * n + i)
    }
  }
}

function sumUncoveredNeed(covMask: Uint8Array, need: Float32Array, bit: number) {
  let s = 0
  for (let i = 0; i < covMask.length; i++) {
    if ((covMask[i] & bit) !== bit) s += need[i]
  }
  return s
}

function coverageGainScore(
  world: World,
  plannedCov: Uint8Array,
  type: SensorType,
  cell: number,
  need: Float32Array,
  sensors: SensorConfig[],
  planned: Omit<SensorConfig, 'id'>[],
) {
  const n = world.gridSize
  const maskBit = type === 'suolo' ? COVER_SOIL : type === 'clima' ? COVER_CLIMATE : COVER_BIO
  const radiusM = type === 'clima' ? world.worldSizeM * 0.5 : type === 'suolo' ? world.worldSizeM * 0.14 : world.worldSizeM * 0.18
  const radCells = Math.max(1, Math.floor(radiusM / world.cellSizeM))
  const ci = cell % n
  const cj = Math.floor(cell / n)

  // discourage clustering
  const pos = cellToWorldXZ(world, cell)
  let minD = Infinity
  for (const s of sensors) {
    const dx = s.position.x - pos.x
    const dz = s.position.z - pos.z
    minD = Math.min(minD, Math.sqrt(dx * dx + dz * dz))
  }
  for (const s of planned) {
    const dx = s.position.x - pos.x
    const dz = s.position.z - pos.z
    minD = Math.min(minD, Math.sqrt(dx * dx + dz * dz))
  }
  const spread = clamp01(minD / (world.worldSizeM * 0.22))

  let gain = 0
  for (let dz = -radCells; dz <= radCells; dz++) {
    for (let dx = -radCells; dx <= radCells; dx++) {
      if (dx * dx + dz * dz > radCells * radCells) continue
      const i = ci + dx
      const j = cj + dz
      if (i < 0 || j < 0 || i >= n || j >= n) continue
      const c = j * n + i
      if ((plannedCov[c] & maskBit) === maskBit) continue
      gain += need[c]
    }
  }
  return gain * (0.5 + 0.6 * spread) + need[cell] * 0.25
}

export function estimateEcosystemSummary(world: World) {
  const nCells = world.gridSize * world.gridSize
  let cover = 0
  let biod = 0
  let carbon = 0
  let degraded = 0
  let degradedRecovered = 0
  for (let c = 0; c < nCells; c++) {
    cover += world.canopyCover[c]
    biod += world.biodiversity[c]
    carbon += world.carbon[c]
    if (world.degradedMask[c]) {
      degraded++
      if (world.canopyCover[c] > 0.18) degradedRecovered++
    }
  }
  const plantC = estimatePlantBiomassKgC(world)
  return {
    vegetativeCover: cover / nCells,
    biodiversity: biod / nCells,
    carbonStorageKgC: carbon + plantC,
    degradedRegen: degraded ? degradedRecovered / degraded : 1,
  }
}

