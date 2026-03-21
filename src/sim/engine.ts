import type { ProjectConfig, SpeciesConfig, World } from './types'
import { clamp01, lerp, mulberry32, smoothstep } from './random'
import { neighborCells } from './terrain'

type StepCtx = {
  rng: () => number
  speciesById: Map<string, SpeciesConfig>
  tempC: number
  rainMm: number
  wind: number
  windDirRad: number
  drought: boolean
}

export type SimStepResult = {
  newPlants: number
  deaths: number
}

export function simStep(world: World, project: ProjectConfig, dtDays: number, seed: number): SimStepResult {
  const rng = mulberry32((seed + Math.floor(world.day * 1000)) | 0)
  const speciesById = new Map(project.species.map((s) => [s.id, s]))

  const day0 = world.day
  world.day += dtDays
  world.seasonDay = (world.seasonDay + dtDays) % 365

  const seasonT = Math.sin(((world.seasonDay - 80) / 365) * Math.PI * 2)
  const tempC = project.terrain.meanTempC + project.terrain.seasonalTempAmpC * seasonT

  const climate = project.climate
  const baselineRain = project.climate.meanRainMmDay * (0.65 + 0.7 * clamp01(0.6 - seasonT * 0.5))
  let rainMm = baselineRain * dtDays
  let wind = clamp01(climate.windMean + (rng() - 0.5) * 0.25)
  let drought = false
  const windDirRad = rng() * Math.PI * 2

  // Random climate events
  if (rng() < climate.droughtChancePerDay * dtDays) {
    drought = true
    rainMm *= 0.05
  } else if (rng() < 0.12 * dtDays) {
    rainMm *= lerp(0.6, 2.2, rng())
  }

  if (rng() < 0.18 * dtDays) {
    wind = clamp01(wind + lerp(0.15, 0.45, rng()))
  }

  const ctx: StepCtx = { rng, speciesById, tempC, rainMm, wind, windDirRad, drought }

  // Hydrology + soil chemistry
  soilStep(world, project, ctx, dtDays)

  // Plant dynamics (growth, stress, death, seeding)
  const { newPlants, deaths } = plantStep(world, ctx, dtDays)

  // Ecological indicators
  updateIndicators(world, ctx)

  // Carbon update: slow soil carbon accumulation with cover; loss with dryness/invasives
  carbonStep(world, dtDays)

  // Climate shocks that kill plants are modeled with separate rare events (handled in AI layer / store),
  // but we still emulate some continuous wind stress here.
  windStress(world, ctx, dtDays)

  // Ensure monotonic day progression (avoid NaNs)
  if (!Number.isFinite(world.day) || world.day < day0) world.day = day0

  return { newPlants, deaths }
}

function soilStep(world: World, project: ProjectConfig, ctx: StepCtx, dtDays: number) {
  const nCells = world.gridSize * world.gridSize
  const temp = ctx.tempC
  const wind = ctx.wind
  const rain = ctx.rainMm
  const n = world.gridSize

  for (let c = 0; c < nCells; c++) {
    const canopy = world.canopyCover[c]
    const shade = world.shade[c]
    const moist = world.moisturePct[c]

    // Simplified water balance.
    const evap = (0.45 + 0.06 * Math.max(0, temp - 5)) * (0.65 + 0.7 * wind) * (1 - 0.55 * canopy) * (1 - 0.15 * shade)
    const infil = rain * (0.65 + 0.25 * shade)
    let next = moist + infil - evap * dtDays

    if (ctx.drought) next *= 0.985
    world.moisturePct[c] = Math.min(100, Math.max(0, next))

    // Very slow pH drift toward base with organic input.
    const targetPh = project.terrain.ph + (canopy - 0.2) * 0.12
    world.ph[c] = Math.min(9, Math.max(4, world.ph[c] + (targetPh - world.ph[c]) * (0.002 * dtDays)))

    // Nutrient mineralization: depends on moisture and temp.
    const m = world.moisturePct[c] / 100
    const mineral = (0.015 + 0.03 * m) * smoothstep(0, 25, temp) * (0.6 + 0.6 * canopy)
    // baseline deposition keeps long runs from collapsing to zero
    const dep = 0.02 + 0.03 * m
    world.n[c] = Math.max(0, world.n[c] + (mineral * 2.2 + dep * 0.8) * dtDays)
    world.p[c] = Math.max(0, world.p[c] + (mineral * 1.4 + dep * 0.5) * dtDays)
    world.k[c] = Math.max(0, world.k[c] + (mineral * 1.6 + dep * 0.7) * dtDays)
  }

  // Gentle diffusion between neighbor cells (water + nutrients).
  const diff = Math.min(0.25, 0.04 * dtDays)
  if (diff > 0) {
    const nextM = new Float32Array(world.moisturePct)
    const nextN = new Float32Array(world.n)
    const nextP = new Float32Array(world.p)
    const nextK = new Float32Array(world.k)

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i
        let mSum = world.moisturePct[c]
        let nSum = world.n[c]
        let pSum = world.p[c]
        let kSum = world.k[c]
        let cnt = 1
        if (i > 0) {
          const cc = c - 1
          mSum += world.moisturePct[cc]
          nSum += world.n[cc]
          pSum += world.p[cc]
          kSum += world.k[cc]
          cnt++
        }
        if (i < n - 1) {
          const cc = c + 1
          mSum += world.moisturePct[cc]
          nSum += world.n[cc]
          pSum += world.p[cc]
          kSum += world.k[cc]
          cnt++
        }
        if (j > 0) {
          const cc = c - n
          mSum += world.moisturePct[cc]
          nSum += world.n[cc]
          pSum += world.p[cc]
          kSum += world.k[cc]
          cnt++
        }
        if (j < n - 1) {
          const cc = c + n
          mSum += world.moisturePct[cc]
          nSum += world.n[cc]
          pSum += world.p[cc]
          kSum += world.k[cc]
          cnt++
        }
        const mAvg = mSum / cnt
        const nAvg = nSum / cnt
        const pAvg = pSum / cnt
        const kAvg = kSum / cnt
        nextM[c] = world.moisturePct[c] * (1 - diff) + mAvg * diff
        nextN[c] = world.n[c] * (1 - diff) + nAvg * diff
        nextP[c] = world.p[c] * (1 - diff) + pAvg * diff
        nextK[c] = world.k[c] * (1 - diff) + kAvg * diff
      }
    }

    world.moisturePct.set(nextM)
    world.n.set(nextN)
    world.p.set(nextP)
    world.k.set(nextK)
  }
}

function plantStep(world: World, ctx: StepCtx, dtDays: number): SimStepResult {
  let newPlants = 0
  let deaths = 0

  const n = world.gridSize
  const cellSize = world.cellSizeM
  const nCells = n * n

  // Recompute canopy cover from current plants (prevents stale accumulation).
  world.canopyCover.fill(0)
  for (let i = 0; i < world.plants.length; i++) {
    const p = world.plants[i]
    if (!p.alive) continue
    const c = p.cell
    const cover = clamp01((p.canopyRadiusM / Math.max(0.001, cellSize)) * 0.62)
    world.canopyCover[c] = Math.max(world.canopyCover[c], cover)
  }

  // Precompute a cheap neighbor canopy influence to avoid O(N^2).
  const neighborCanopy = new Float32Array(nCells)
  for (let c = 0; c < nCells; c++) {
    const neigh = neighborCells(world, c)
    let influence = 0
    for (const nc of neigh) influence += world.canopyCover[nc] * 0.22
    neighborCanopy[c] = Math.min(1.25, influence)
  }

  // Update each plant.
  for (let i = 0; i < world.plants.length; i++) {
    const plant = world.plants[i]
    if (!plant.alive) continue
    const species = ctx.speciesById.get(plant.speciesId)
    if (!species) continue

    const c = plant.cell
    const moist = world.moisturePct[c]
    const ph = world.ph[c]
    const temp = ctx.tempC
    const shade = world.shade[c]
    const light = clamp01(1 - shade - 0.35 * neighborCanopy[c])

    // Germination phase: ageDays < 0 means "seed in soil".
    if (plant.ageDays < 0) {
      plant.ageDays += dtDays
      // Seeds can fail if conditions are bad.
      const phOk = ph >= species.seed.phMin && ph <= species.seed.phMax
      const moistOk = moist >= species.seed.minMoisturePct
      const tempOk = temp >= species.tolerance.tempMinC && temp <= species.tolerance.tempMaxC
      const invOk = world.invasive[c] < 0.85
      const ok = phOk && moistOk && tempOk && invOk
      if (!ok && ctx.rng() < 0.02 * dtDays) {
        plant.alive = false
        deaths++
        if (world.occupancy[c] === i) world.occupancy[c] = -1
      }
      continue
    }

    // Suitability (0..1)
    const phSuit = smoothstep(species.tolerance.phMin, species.tolerance.phMin + 0.6, ph) * (1 - smoothstep(species.tolerance.phMax - 0.6, species.tolerance.phMax, ph))
    const tempSuit =
      smoothstep(species.tolerance.tempMinC, species.tolerance.tempMinC + 8, temp) *
      (1 - smoothstep(species.tolerance.tempMaxC - 8, species.tolerance.tempMaxC, temp))
    const moistSuit = smoothstep(species.seed.minMoisturePct * 0.6, species.seed.minMoisturePct + 12, moist)
    const shadeSuit = lerp(1 - species.shadePreference, 1, shade)
    const baseSuit = clamp01(phSuit * 0.35 + tempSuit * 0.35 + moistSuit * 0.25 + shadeSuit * 0.05)

    const droughtPenalty = ctx.drought ? (1 - 0.5 * species.tolerance.drought) : 1
    // Competition: reduce resource by local canopy and invasives.
    const competition = clamp01(world.canopyCover[c] * 0.55 + neighborCanopy[c] * 0.25 + world.invasive[c] * 0.25)
    const resource = clamp01(light * (0.55 + 0.55 * (moist / 100)) * droughtPenalty * (1 - 0.55 * competition))

    // Nutrient factor (cheap: compare combined availability to demand)
    const demand = species.nutrientUsePerDay
    const nAvail = world.n[c] / 100
    const pAvail = world.p[c] / 100
    const kAvail = world.k[c] / 100
    const nutr = clamp01((nAvail / (0.12 + demand.n)) * 0.34 + (pAvail / (0.12 + demand.p)) * 0.33 + (kAvail / (0.12 + demand.k)) * 0.33)

    const growthDrive = clamp01(baseSuit * resource * nutr)
    const stress = 1 - growthDrive

    // Health integrates stress over time (kept intentionally "slow" to avoid mass die-off from short dry spells).
    plant.health = clamp01(plant.health + (growthDrive - 0.5) * 0.06 * dtDays - stress * 0.008 * dtDays)

    // Logistic growth toward maxima.
    const ageT = clamp01(plant.ageDays / Math.max(1, species.maturityDays))
    const baseRate = lerp(0.03, 0.008, ageT) // young grow faster
    const gh = baseRate * growthDrive * dtDays

    plant.heightM = Math.min(species.maxHeightM, plant.heightM + gh * (0.8 + 1.2 * (1 - plant.heightM / species.maxHeightM)) * species.maxHeightM * 0.02)
    plant.trunkRadiusM = Math.min(species.maxTrunkRadiusM, plant.trunkRadiusM + gh * species.maxTrunkRadiusM * 0.015)
    plant.canopyRadiusM = Math.min(species.maxCanopyRadiusM, plant.canopyRadiusM + gh * species.maxCanopyRadiusM * 0.02)
    plant.rootDepthM = Math.min(species.rootDepthM, plant.rootDepthM + gh * species.rootDepthM * 0.012)
    plant.ageDays += dtDays

    // Uptake (bounded). Scale by plant size so seedlings don't instantly drain a cell.
    const sizeT = clamp01(plant.canopyRadiusM / Math.max(0.001, species.maxCanopyRadiusM))
    const uptakeT = (0.15 + 0.85 * sizeT) * (0.35 + 0.65 * growthDrive)

    // Roots draw from a small neighborhood (more realistic than consuming only the plant's cell).
    const rootZoneM = Math.max(0.8, Math.min(4.5, plant.canopyRadiusM * 0.6 + plant.rootDepthM * 0.25))
    const radCells = Math.max(0, Math.min(3, Math.floor(rootZoneM / cellSize)))
    const samples = 3 + Math.floor(sizeT * 3) // 3..6 samples

    const waterUptake = species.waterUsePerDay * uptakeT * dtDays * 1.35
    const nutrUptake = uptakeT * dtDays
    const nNeed = demand.n * nutrUptake * 0.55
    const pNeed = demand.p * nutrUptake * 0.45
    const kNeed = demand.k * nutrUptake * 0.5

    if (radCells === 0) {
      world.moisturePct[c] = Math.max(0, world.moisturePct[c] - waterUptake)
      world.n[c] = Math.max(0, world.n[c] - nNeed)
      world.p[c] = Math.max(0, world.p[c] - pNeed)
      world.k[c] = Math.max(0, world.k[c] - kNeed)
    } else {
      const prng = mulberry32((plant.id * 2654435761) ^ (Math.floor(world.day) * 1013904223))
      let wRem = waterUptake
      let nRem = nNeed
      let pRem = pNeed
      let kRem = kNeed

      for (let s = 0; s < samples; s++) {
        // Pick a target cell inside a disk.
        let dx = 0
        let dz = 0
        for (let tries = 0; tries < 8; tries++) {
          dx = Math.floor((prng() * 2 - 1) * (radCells + 0.999))
          dz = Math.floor((prng() * 2 - 1) * (radCells + 0.999))
          if (dx * dx + dz * dz <= radCells * radCells) break
        }
        const ti = (c % n) + dx
        const tj = Math.floor(c / n) + dz
        if (ti < 0 || tj < 0 || ti >= n || tj >= n) continue
        const tc = tj * n + ti

        const falloff = 1 - (dx * dx + dz * dz) / Math.max(1, radCells * radCells)
        const wTake = Math.min(world.moisturePct[tc], (wRem / Math.max(1, samples - s)) * (0.7 + 0.3 * falloff))
        world.moisturePct[tc] = Math.max(0, world.moisturePct[tc] - wTake)
        wRem = Math.max(0, wRem - wTake)

        const nTake = Math.min(world.n[tc], (nRem / Math.max(1, samples - s)) * (0.7 + 0.3 * falloff))
        const pTake = Math.min(world.p[tc], (pRem / Math.max(1, samples - s)) * (0.7 + 0.3 * falloff))
        const kTake = Math.min(world.k[tc], (kRem / Math.max(1, samples - s)) * (0.7 + 0.3 * falloff))

        world.n[tc] = Math.max(0, world.n[tc] - nTake)
        world.p[tc] = Math.max(0, world.p[tc] - pTake)
        world.k[tc] = Math.max(0, world.k[tc] - kTake)

        nRem = Math.max(0, nRem - nTake)
        pRem = Math.max(0, pRem - pTake)
        kRem = Math.max(0, kRem - kTake)

        if (wRem + nRem + pRem + kRem < 1e-6) break
      }

      // Any remainder draws from the plant cell as a fallback.
      if (wRem > 0) world.moisturePct[c] = Math.max(0, world.moisturePct[c] - wRem)
      if (nRem > 0) world.n[c] = Math.max(0, world.n[c] - nRem)
      if (pRem > 0) world.p[c] = Math.max(0, world.p[c] - pRem)
      if (kRem > 0) world.k[c] = Math.max(0, world.k[c] - kRem)
    }

    // Mortality.
    const mortRisk = clamp01(0.00015 + Math.max(0, 0.18 - plant.health) * 0.006 + stress * 0.0008)
    if (ctx.rng() < mortRisk * dtDays) {
      plant.alive = false
      deaths++
      if (world.occupancy[c] === i) world.occupancy[c] = -1
      continue
    }

    // Seed dispersal.
    const reproAge = Math.max(species.germinationDays * 5, species.maturityDays * 0.25)
    if (plant.ageDays >= reproAge) {
      const pSeed = 1 - Math.pow(1 - species.seed.probabilityPerDay, dtDays)
      if (ctx.rng() < pSeed && world.day - plant.lastSeedDay > 2) {
        plant.lastSeedDay = world.day
        // Disperse a small cluster of seeds; distance is biased toward near-parent,
        // with wind adding a directional drift.
        // A small but noticeable seed rain (still limited by germination constraints and space).
        const seeds = 2 + Math.floor(ctx.rng() * 5)
        for (let s = 0; s < seeds; s++) {
          const maxM = Math.max(1, species.seed.distanceM)
          const r = Math.min(maxM, -Math.log(Math.max(1e-6, 1 - ctx.rng())) * (maxM * 0.35))
          const a = (ctx.rng() * Math.PI * 2) * (1 - ctx.wind * 0.55) + ctx.windDirRad * (ctx.wind * 0.55)
          const dxM = Math.cos(a) * r
          const dzM = Math.sin(a) * r
          const dx = Math.round(dxM / cellSize)
          const dz = Math.round(dzM / cellSize)
          const ci = c % n
          const cj = Math.floor(c / n)
          const ti = ci + dx
          const tj = cj + dz
          if (ti < 0 || tj < 0 || ti >= n || tj >= n) continue
          const tc = tj * n + ti
          if (world.occupancy[tc] !== -1) continue
          if (world.invasive[tc] > 0.8) continue
          const tMoist = world.moisturePct[tc]
          const tPh = world.ph[tc]
          const tShade = world.shade[tc]
          const tLight = clamp01(1 - tShade - 0.35 * neighborCanopy[tc])
          if (tLight < 0.12) continue
          if (tMoist < species.seed.minMoisturePct) continue
          if (tPh < species.seed.phMin || tPh > species.seed.phMax) continue

          // Create a "seed" that needs to survive until germination time.
          spawnPlant(world, species.id, tc, ctx, { matureBoost: false, seedPhase: true })
          newPlants++
        }
      }
    }
  }

  // Reset canopy cover for empty cells and where plants died (done in indicator update too).
  for (let c = 0; c < nCells; c++) {
    if (world.occupancy[c] === -1) world.canopyCover[c] *= 0.88
  }

  // Invasives: occupy empty, disturbed, sunny cells; suppressed by canopy.
  for (let c = 0; c < nCells; c++) {
    const canopy = world.canopyCover[c]
    const moist = world.moisturePct[c] / 100
    const inv = world.invasive[c]
    const invGrow = (1 - canopy) * (0.18 + 0.65 * moist) * (0.25 + 0.55 * (world.n[c] / 100))
    const invDie = canopy * 0.22 + 0.03 * (1 - moist)
    let next = inv + (invGrow - invDie) * 0.02 * dtDays
    if (world.occupancy[c] !== -1) next *= 0.997
    world.invasive[c] = clamp01(next)
  }

  return { newPlants, deaths }
}

function spawnPlant(world: World, speciesId: string, cell: number, ctx: StepCtx, opts: { matureBoost: boolean; seedPhase?: boolean }) {
  const id = world.plants.length
  const species = ctx.speciesById.get(speciesId)
  if (!species) return

  const matureBoost = opts.matureBoost
  const ageDays = opts.seedPhase ? -Math.max(1, species.germinationDays) : matureBoost ? species.maturityDays * lerp(0.7, 1.1, ctx.rng()) : 0
  const t = clamp01(ageDays / Math.max(1, species.maturityDays))

  const plant = {
    id,
    speciesId,
    cell,
    ageDays,
    heightM: opts.seedPhase ? 0.06 : lerp(0.18, species.maxHeightM * 0.12, t),
    trunkRadiusM: opts.seedPhase ? 0.004 : lerp(0.01, species.maxTrunkRadiusM * 0.15, t),
    canopyRadiusM: opts.seedPhase ? 0.03 : lerp(0.08, species.maxCanopyRadiusM * 0.18, t),
    rootDepthM: opts.seedPhase ? 0.02 : lerp(0.06, species.rootDepthM * 0.25, t),
    health: opts.seedPhase ? lerp(0.45, 0.62, ctx.rng()) : matureBoost ? lerp(0.62, 0.92, ctx.rng()) : lerp(0.35, 0.6, ctx.rng()),
    alive: true,
    lastSeedDay: -999,
  }
  world.plants.push(plant)
  world.occupancy[cell] = id
}

export function seedInitialPlants(world: World, project: ProjectConfig, seed: number) {
  // Called once after world + species exist.
  const rng = mulberry32(seed ^ 0xdeadbeef)
  const species = project.species
  if (species.length === 0) return
  const speciesById = new Map(species.map((s) => [s.id, s]))
  const ctx: StepCtx = {
    rng,
    speciesById,
    tempC: project.terrain.meanTempC,
    rainMm: project.climate.meanRainMmDay,
    wind: project.climate.windMean,
    windDirRad: rng() * Math.PI * 2,
    drought: false,
  }

  const nCells = world.gridSize * world.gridSize
  const target = Math.floor(nCells * 0.08)
  let placed = 0
  for (let tries = 0; tries < nCells * 4 && placed < target; tries++) {
    const c = Math.floor(rng() * nCells)
    if (world.occupancy[c] !== -1) continue
    if (world.degradedMask[c] === 1) continue
    const s = species[Math.floor(rng() * species.length)]
    const ph = world.ph[c]
    const moist = world.moisturePct[c]
    if (ph < s.tolerance.phMin || ph > s.tolerance.phMax) continue
    if (moist < s.seed.minMoisturePct * 0.75) continue
    spawnPlant(world, s.id, c, ctx, { matureBoost: true })
    placed++
  }
}

function updateIndicators(world: World, ctx: StepCtx) {
  const nCells = world.gridSize * world.gridSize
  world.biodiversity.fill(0)
  world.fireRisk.fill(0)

  for (let c = 0; c < nCells; c++) {
    // biodiversity proxy: mix of canopy + low invasives + local heterogeneity (shade & moisture)
    const inv = world.invasive[c]
    const canopy = world.canopyCover[c]
    const moist = world.moisturePct[c] / 100
    const shade = world.shade[c]
    const bio = clamp01(0.15 + 0.55 * canopy + 0.2 * moist + 0.15 * (1 - inv) + 0.08 * (1 - Math.abs(shade - 0.55)))
    world.biodiversity[c] = bio

    // fire risk: dryness + wind + fuel (invasives and canopy); shade reduces dryness a bit.
    const dry = 1 - moist
    const fuel = clamp01(0.4 * canopy + 0.6 * inv)
    const fire = clamp01(dry * (0.55 + 0.6 * ctx.wind) * (0.3 + 0.85 * fuel) * (1 - 0.15 * shade))
    world.fireRisk[c] = fire

    if (world.occupancy[c] === -1) world.canopyCover[c] *= 0.985
  }
}

function carbonStep(world: World, dtDays: number) {
  const nCells = world.gridSize * world.gridSize
  for (let c = 0; c < nCells; c++) {
    const canopy = world.canopyCover[c]
    const moist = world.moisturePct[c] / 100
    const inv = world.invasive[c]
    const add = (0.012 + 0.05 * canopy) * (0.5 + 0.6 * moist)
    const loss = (0.01 + 0.06 * inv) * (0.35 + 0.85 * (1 - moist))
    world.carbon[c] = Math.max(0, world.carbon[c] + (add - loss) * dtDays)
  }
}

function windStress(world: World, ctx: StepCtx, dtDays: number) {
  const wind = ctx.wind
  if (wind < 0.6) return
  for (let i = 0; i < world.plants.length; i++) {
    const p = world.plants[i]
    if (!p.alive) continue
    const stress = clamp01((wind - 0.6) * (p.heightM / 25))
    p.health = clamp01(p.health - stress * 0.02 * dtDays)
  }
}

export function estimatePlantBiomassKgC(world: World) {
  // Toy allometry: canopy ~ leaf+wood; trunk radius and height create biomass proxy.
  let sum = 0
  for (const p of world.plants) {
    if (!p.alive) continue
    const v = Math.PI * p.trunkRadiusM * p.trunkRadiusM * Math.max(0.5, p.heightM)
    const canopy = p.canopyRadiusM * p.canopyRadiusM * 0.9
    sum += (v * 140 + canopy * 4.5) * 0.48 // kgC
  }
  return sum
}
