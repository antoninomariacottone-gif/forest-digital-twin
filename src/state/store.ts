import { create } from 'zustand'
import type { AiSuggestion, ClimateConfig, Intervention, LogEvent, MetricsPoint, ProjectConfig, SensorConfig, SensorType, SpeciesConfig, TerrainConfig, Vec2, World } from '../sim/types'
import { createWorldFromProject, worldXZToCell } from '../sim/terrain'
import { seedInitialPlants, simStep } from '../sim/engine'
import { computeMetrics } from '../sim/metrics'
import { applyIntervention, suggestInterventions, suggestSensorPlacement } from '../sim/ai'
import { computeCoverage, COVER_BIO, COVER_CLIMATE, COVER_SOIL, quantizeSensorCost, worldClampPosition } from '../sim/sensors'
import { clamp01, lerp, mulberry32, smoothstep } from '../sim/random'
import { deepClone } from '../sim/clone'

type OverlayMode =
  | 'none'
  | 'coverage'
  | 'moisture'
  | 'nutrients_n'
  | 'nutrients_p'
  | 'nutrients_k'
  | 'carbon'
  | 'ph'
  | 'fire'
  | 'invasive'
  | 'biodiversity'

type SimState = {
  project: ProjectConfig | null
  world: World | null
  worldVersion: number

  budgetCredits: number
  spentCredits: number

  sensors: SensorConfig[]
  suggestions: AiSuggestion[]
  pendingInterventions: Intervention[]

  metrics: MetricsPoint[]
  logs: LogEvent[]

  isRunning: boolean
  speed: number
  autoMode: boolean
  assistedColonization: boolean

  overlayMode: OverlayMode
  showRoots: boolean

  selectedCell: number | null
  placingSensor: null | { type: SensorType; radiusM: number; precision: number }

  initFromProject: (p: ProjectConfig) => void
  setRunning: (v: boolean) => void
  setSpeed: (v: number) => void
  setAutoMode: (v: boolean) => void
  setAssistedColonization: (v: boolean) => void
  setOverlayMode: (m: OverlayMode) => void
  setShowRoots: (v: boolean) => void
  setSelectedCell: (c: number | null) => void

  updateTerrain: (partial: Partial<TerrainConfig>) => void
  updateClimate: (partial: Partial<ClimateConfig>) => void
  regenerateTerrain: () => void

  addSpecies: (s: SpeciesConfig) => void
  updateSpecies: (id: string, partial: Partial<SpeciesConfig>) => void
  removeSpecies: (id: string) => void

  requestSensorPlan: () => void
  approveSensorPlan: (suggestionId: string) => void
  rejectSuggestion: (suggestionId: string, reason?: string) => void

  beginPlaceSensor: (type: SensorType) => void
  cancelPlaceSensor: () => void
  placeSensorAt: (pos: Vec2) => void
  removeSensor: (id: string) => void

  requestInterventions: () => void
  approveIntervention: (id: string) => void
  rejectIntervention: (id: string, reason?: string) => void

  tick: (dtSec: number) => void
}

function pushLog(logs: LogEvent[], ev: LogEvent) {
  logs.push(ev)
  if (logs.length > 220) logs.splice(0, logs.length - 220)
}

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`
}

export const useSimStore = create<SimState>((set, get) => ({
  project: null,
  world: null,
  worldVersion: 0,

  budgetCredits: 0,
  spentCredits: 0,

  sensors: [],
  suggestions: [],
  pendingInterventions: [],
  metrics: [],
  logs: [],

  isRunning: true,
  speed: 8,
  autoMode: false,
  assistedColonization: true,

  overlayMode: 'coverage',
  showRoots: false,

  selectedCell: null,
  placingSensor: null,

  initFromProject: (p) => {
    const world = createWorldFromProject(p, 1337)
    seedInitialPlants(world, p, 1337)
    const logs: LogEvent[] = [{ day: 0, type: 'terrain_regenerated', message: 'Terreno generato: patch degradate + sorgenti di semi iniziali.' }]
    const metrics = [computeMetrics(world, 0)]
    set({
      project: deepClone(p),
      world,
      worldVersion: 1,
      budgetCredits: p.budgetCredits,
      spentCredits: 0,
      sensors: [],
      suggestions: [],
      pendingInterventions: [],
      logs,
      metrics,
      selectedCell: null,
      placingSensor: null,
    })
  },

  setRunning: (v) => set({ isRunning: v }),
  // `speed` is expressed as simulation-days per real-second.
  setSpeed: (v) => set({ speed: Math.max(0, Math.min(365, v)) }),
  setAutoMode: (v) => set({ autoMode: v }),
  setAssistedColonization: (v) => set({ assistedColonization: v }),
  setOverlayMode: (m) => set({ overlayMode: m }),
  setShowRoots: (v) => set({ showRoots: v }),
  setSelectedCell: (c) => set({ selectedCell: c }),

  updateTerrain: (partial) => {
    const { project } = get()
    if (!project) return
    set({ project: { ...project, terrain: { ...project.terrain, ...partial } } })
  },

  updateClimate: (partial) => {
    const { project } = get()
    if (!project) return
    set({ project: { ...project, climate: { ...project.climate, ...partial } } })
  },

  regenerateTerrain: () => {
    const { project, spentCredits } = get()
    if (!project) return
    const next = deepClone(project)
    const world = createWorldFromProject(next, Math.floor(1000 + Math.random() * 1e6))
    seedInitialPlants(world, next, 1337)
    const logs = [...get().logs]
    pushLog(logs, { day: Math.floor(world.day), type: 'terrain_regenerated', message: 'Terreno rigenerato (reset simulazione ecologica, sensori invariati).' })
    set({
      world,
      worldVersion: get().worldVersion + 1,
      metrics: [computeMetrics(world, spentCredits)],
      logs,
      selectedCell: null,
    })
  },

  addSpecies: (s) => {
    const { project } = get()
    if (!project) return
    set({ project: { ...project, species: [...project.species, s] } })
  },

  updateSpecies: (id, partial) => {
    const { project } = get()
    if (!project) return
    set({ project: { ...project, species: project.species.map((s) => (s.id === id ? { ...s, ...partial } : s)) } })
  },

  removeSpecies: (id0) => {
    const { project } = get()
    if (!project) return
    set({ project: { ...project, species: project.species.filter((s) => s.id !== id0) } })
  },

  requestSensorPlan: () => {
    const { world, project, sensors, budgetCredits, spentCredits } = get()
    if (!world || !project) return
    const remaining = Math.max(0, budgetCredits - spentCredits)
    const s = suggestSensorPlacement(world, sensors, remaining, 9876)
    if (!s) return
    const suggestions = [s, ...get().suggestions].slice(0, 12)
    const logs = [...get().logs]
    pushLog(logs, { day: Math.floor(world.day), type: 'ai_suggest_sensor', message: `AI propone ${s.sensors.length} sensori per massimizzare copertura (costo: ${s.totalCost} cr). Richiede approvazione.` })
    set({ suggestions, logs })

    if (get().autoMode) get().approveSensorPlan(s.id)
  },

  approveSensorPlan: (suggestionId) => {
    const { world, budgetCredits, spentCredits } = get()
    if (!world) return
    const suggestion = get().suggestions.find((x) => x.id === suggestionId)
    if (!suggestion || suggestion.kind !== 'sensor_plan') return
    const remaining = Math.max(0, budgetCredits - spentCredits)
    if (suggestion.totalCost > remaining) {
      const logs = [...get().logs]
      pushLog(logs, { day: Math.floor(world.day), type: 'ai_blocked_no_data', message: 'Piano sensori non applicato: budget insufficiente.' })
      set({ logs })
      return
    }

    const sensors: SensorConfig[] = [...get().sensors]
    for (const s of suggestion.sensors) {
      sensors.push({ ...s, id: id('sens') })
    }
    const logs = [...get().logs]
    pushLog(logs, { day: Math.floor(world.day), type: 'sensor_added', message: `Aggiunti ${suggestion.sensors.length} sensori (spesa: ${suggestion.totalCost} cr).` })
    set({
      sensors,
      spentCredits: spentCredits + suggestion.totalCost,
      suggestions: get().suggestions.filter((x) => x.id !== suggestionId),
      logs,
    })
  },

  rejectSuggestion: (suggestionId, reason) => {
    const { world } = get()
    if (!world) return
    const logs = [...get().logs]
    pushLog(logs, { day: Math.floor(world.day), type: 'intervention_rejected', message: `Suggerimento AI rifiutato. ${reason ?? ''}`.trim() })
    set({ suggestions: get().suggestions.filter((x) => x.id !== suggestionId), logs })
  },

  beginPlaceSensor: (type) => set({ placingSensor: { type, radiusM: type === 'clima' ? 120 : type === 'suolo' ? 28 : 36, precision: type === 'biodiversita' ? 0.8 : 0.7 } }),
  cancelPlaceSensor: () => set({ placingSensor: null }),

  placeSensorAt: (pos0) => {
    const { world, budgetCredits, spentCredits, placingSensor } = get()
    if (!world || !placingSensor) return
    const pos = worldClampPosition(world, pos0)
    const cost = quantizeSensorCost(placingSensor.type, placingSensor.precision, placingSensor.radiusM)
    const remaining = Math.max(0, budgetCredits - spentCredits)
    if (cost > remaining) return
    const sensors = [...get().sensors, { id: id('sens'), type: placingSensor.type, position: pos, radiusM: placingSensor.radiusM, precision: placingSensor.precision, cost }]
    const logs = [...get().logs]
    pushLog(logs, { day: Math.floor(world.day), type: 'sensor_added', message: `Sensore ${placingSensor.type} aggiunto (costo: ${cost} cr).` })
    set({ sensors, spentCredits: spentCredits + cost, placingSensor: null, logs })
  },

  removeSensor: (id0) => set({ sensors: get().sensors.filter((s) => s.id !== id0) }),

  requestInterventions: () => {
    const { world, project, sensors, budgetCredits, spentCredits } = get()
    if (!world || !project) return
    const remaining = Math.max(0, budgetCredits - spentCredits)
    const sug = suggestInterventions(world, project, sensors, remaining, 4567)
    if (sug.length === 0) return
    const suggestions = [...sug, ...get().suggestions].slice(0, 18)
    const logs = [...get().logs]
    pushLog(logs, { day: Math.floor(world.day), type: 'ai_suggest_intervention', message: `AI propone ${sug.length} interventi (richiede approvazione).` })
    set({ suggestions, logs })

    if (get().autoMode) {
      for (const s of sug) {
        if (s.kind === 'intervention') {
          const it: Intervention = { ...s.intervention, id: id('int') }
          set({ pendingInterventions: [it, ...get().pendingInterventions] })
          get().approveIntervention(it.id)
        }
      }
    }
  },

  approveIntervention: (id0) => {
    const { world, project, sensors, budgetCredits, spentCredits } = get()
    if (!world || !project) return
    const pending = get().pendingInterventions
    const it = pending.find((x) => x.id === id0)
    if (!it) return

    const remaining = Math.max(0, budgetCredits - spentCredits)
    if (it.cost > remaining) return

    // Enforce: no interventions without sensor coverage.
    const cov = computeCoverage(world, sensors)
    const required =
      it.type === 'semina_droni'
        ? COVER_SOIL | COVER_CLIMATE
        : it.type === 'rimozione_invasive'
          ? COVER_BIO
          : COVER_CLIMATE | COVER_BIO

    let ok = true
    if (it.payload.kind === 'seeding' || it.payload.kind === 'invasive_removal') {
      for (const c of it.payload.cells) {
        if ((cov[c] & required) !== required) {
          ok = false
          break
        }
      }
    } else if (it.payload.kind === 'firebreak') {
      const a = it.payload.polyline[0]
      const b = it.payload.polyline[it.payload.polyline.length - 1]
      const ca = worldXZToCell(world, a.x, a.z)
      const cb = worldXZToCell(world, b.x, b.z)
      ok = (cov[ca] & required) === required && (cov[cb] & required) === required
    }

    const logs = [...get().logs]
    if (!ok) {
      pushLog(logs, { day: Math.floor(world.day), type: 'ai_blocked_no_data', message: 'Intervento bloccato: area non coperta da sensori (dati mancanti).' })
      set({ logs })
      return
    }

    it.approved = true
    applyIntervention(world, project, it, 4242)
    pushLog(logs, { day: Math.floor(world.day), type: 'intervention_applied', message: `Intervento applicato: ${it.type} (costo: ${it.cost} cr).` })
    set({
      world,
      worldVersion: get().worldVersion + 1,
      spentCredits: spentCredits + it.cost,
      pendingInterventions: pending.filter((x) => x.id !== id0),
      logs,
    })
  },

  rejectIntervention: (id0, reason) => {
    const { world } = get()
    if (!world) return
    const logs = [...get().logs]
    pushLog(logs, { day: Math.floor(world.day), type: 'intervention_rejected', message: `Intervento rifiutato. ${reason ?? ''}`.trim() })
    set({ pendingInterventions: get().pendingInterventions.filter((x) => x.id !== id0), logs })
  },

  tick: (dtSec) => {
    const { world, project, budgetCredits, spentCredits } = get()
    if (!world || !project) return

    const dtDays = Math.max(0, dtSec)
    const prevDay = Math.floor(world.day)
    // Stability: split large dt into substeps.
    const maxStepDays = 1.0
    const maxSubsteps = 12
    const steps = Math.min(maxSubsteps, Math.max(1, Math.ceil(dtDays / maxStepDays)))
    const stepDays = dtDays / steps
    for (let i = 0; i < steps; i++) {
      simStep(world, project, stepDays, 1337)
    }

    // Assisted colonization: very small “seed bank” pressure in empty degraded cells,
    // with AI choosing the best-fitting species by local conditions.
    if (get().assistedColonization) {
      const cov = computeCoverage(world, get().sensors)
      const nCells = world.gridSize * world.gridSize
      for (let c = 0; c < nCells; c++) {
        if (!world.degradedMask[c]) continue
        if (world.occupancy[c] !== -1) continue
        if (world.canopyCover[c] > 0.06) continue
        if (world.invasive[c] > 0.82) continue
        // Seed bank only where we have at least some measured data (keeps it “explainable” in UI).
        if (cov[c] === 0) continue
        const pEst = 0.0009 * dtDays * (0.6 + world.moisturePct[c] / 100)
        if (Math.random() < pEst) {
          const best = suggestBestSpeciesId(world, project, c)
          if (!best) continue
          const idp = world.plants.length
          world.plants.push({
            id: idp,
            speciesId: best,
            cell: c,
            ageDays: 0,
            heightM: 0.12,
            trunkRadiusM: 0.008,
            canopyRadiusM: 0.06,
            rootDepthM: 0.05,
            health: 0.6,
            alive: true,
            lastSeedDay: -999,
          })
          world.occupancy[c] = idp
        }
      }
    }

    // Add metrics daily to keep charts light.
    const nextDay = Math.floor(world.day)
    let metrics = get().metrics
    if (nextDay !== prevDay) {
      // Random events (storm / wildfire / disease) at day boundary.
      const logs = [...get().logs]
      applyRandomEvents(world, project, nextDay, logs)
      set({ logs })

      const totalCost = spentCredits
      metrics = [...metrics, computeMetrics(world, totalCost)]
      if (metrics.length > 520) metrics = metrics.slice(metrics.length - 520)
    }

    set({ world, worldVersion: get().worldVersion + 1, metrics })

    // Auto mode can periodically ask AI for suggestions if we have at least some sensors.
    if (get().autoMode && nextDay !== prevDay) {
      if (get().sensors.length === 0) get().requestSensorPlan()
      if (get().sensors.length > 0 && Math.max(0, budgetCredits - spentCredits) > 500) get().requestInterventions()
    }
  },
}))

function suggestBestSpeciesId(world: World, project: ProjectConfig, cell: number) {
  // Local scoring mirrors sim/ai.ts but inline to avoid circular store deps later.
  let bestId: string | null = null
  let bestScore = -1
  const seasonT = Math.sin(((world.seasonDay - 80) / 365) * Math.PI * 2)
  const tempC = project.terrain.meanTempC + project.terrain.seasonalTempAmpC * seasonT
  const moist = world.moisturePct[cell]
  const ph = world.ph[cell]
  const shade = world.shade[cell]
  const nutr = (world.n[cell] + world.p[cell] + world.k[cell]) / 300

  for (const s of project.species) {
    const phSuit = smoothstep(s.tolerance.phMin, s.tolerance.phMin + 0.7, ph) * (1 - smoothstep(s.tolerance.phMax - 0.7, s.tolerance.phMax, ph))
    const tempSuit =
      smoothstep(s.tolerance.tempMinC, s.tolerance.tempMinC + 9, tempC) *
      (1 - smoothstep(s.tolerance.tempMaxC - 9, s.tolerance.tempMaxC, tempC))
    const moistSuit = smoothstep(s.seed.minMoisturePct * 0.65, s.seed.minMoisturePct + 14, moist)
    const shadeSuit = lerp(1 - s.shadePreference, 1, shade)
    const score = clamp01(phSuit * 0.33 + tempSuit * 0.28 + moistSuit * 0.27 + shadeSuit * 0.08 + nutr * 0.04)
    if (score > bestScore) {
      bestScore = score
      bestId = s.id
    }
  }
  return bestId
}

function applyRandomEvents(world: World, project: ProjectConfig, day: number, logs: LogEvent[]) {
  const rng = mulberry32((day * 1664525 + 1013904223) ^ 0x9e3779b9)
  const climate = project.climate

  // Climate mini-events (logged + small nudges)
  if (rng() < 0.28) {
    pushLog(logs, { day, type: 'climate_rain', message: 'Pioggia: incremento lieve umidita superficiale.' })
    const nCells = world.gridSize * world.gridSize
    for (let c = 0; c < nCells; c++) world.moisturePct[c] = Math.min(100, world.moisturePct[c] + 0.3 + 0.6 * rng())
  }
  if (rng() < 0.22) pushLog(logs, { day, type: 'climate_wind', message: 'Vento: aumento stress su piante alte.' })
  if (rng() < climate.droughtChancePerDay) {
    pushLog(logs, { day, type: 'climate_drought', message: 'Siccita: riduzione umidita e aumento rischio incendio.' })
    const nCells = world.gridSize * world.gridSize
    for (let c = 0; c < nCells; c++) world.moisturePct[c] = Math.max(0, world.moisturePct[c] * (0.985 - 0.01 * rng()))
  }

  // Storm: knocks down some tall plants
  if (rng() < climate.stormChancePerDay) {
    let killed = 0
    for (const p of world.plants) {
      if (!p.alive) continue
      const risk = clamp01((p.heightM / 30) * 0.03 + (1 - p.health) * 0.02)
      if (rng() < risk) {
        p.alive = false
        killed++
        if (world.occupancy[p.cell] === p.id) world.occupancy[p.cell] = -1
        world.canopyCover[p.cell] *= 0.2
        world.carbon[p.cell] = Math.max(0, world.carbon[p.cell] - 0.8)
      }
    }
    pushLog(logs, { day, type: 'storm', message: `Tempesta: ${killed} piante abbattute o danneggiate.` })
  }

  // Disease: targets one species and reduces health for a while
  if (rng() < climate.diseaseChancePerDay && project.species.length > 0) {
    const target = project.species[Math.floor(rng() * project.species.length)]
    let hit = 0
    for (const p of world.plants) {
      if (!p.alive) continue
      if (p.speciesId !== target.id) continue
      if (rng() < 0.35) {
        p.health = clamp01(p.health - (0.12 + 0.18 * rng()))
        hit++
      }
    }
    pushLog(logs, { day, type: 'disease', message: `Malattia: colpita specie ${target.name} (piante impattate: ${hit}).` })
  }

  // Wildfire: only if the landscape is actually risky.
  const avgFire = avg(world.fireRisk)
  if (rng() < climate.wildfireChancePerDay && avgFire > 0.42) {
    const nCells = world.gridSize * world.gridSize
    let ignition = -1
    for (let attempt = 0; attempt < 500; attempt++) {
      const c = Math.floor(rng() * nCells)
      if (world.fireRisk[c] > 0.72) {
        ignition = c
        break
      }
    }
    if (ignition >= 0) {
      const burnRadius = Math.floor(world.gridSize * (0.03 + 0.03 * rng()))
      burnDisk(world, ignition, burnRadius, rng)
      pushLog(logs, { day, type: 'wildfire', message: `Incendio: area bruciata (raggio ~${burnRadius} celle) con perdita copertura e carbonio.` })
    }
  }
}

function avg(arr: Float32Array) {
  let s = 0
  for (let i = 0; i < arr.length; i++) s += arr[i]
  return s / Math.max(1, arr.length)
}

function burnDisk(world: World, center: number, rad: number, rng: () => number) {
  const n = world.gridSize
  const ci = center % n
  const cj = Math.floor(center / n)
  for (let dz = -rad; dz <= rad; dz++) {
    for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dz * dz > rad * rad) continue
      const i = ci + dx
      const j = cj + dz
      if (i < 0 || j < 0 || i >= n || j >= n) continue
      const c = j * n + i
      world.canopyCover[c] *= 0.05
      world.invasive[c] = clamp01(world.invasive[c] + 0.08 + 0.12 * rng())
      world.moisturePct[c] = Math.max(0, world.moisturePct[c] * 0.75)
      world.carbon[c] = Math.max(0, world.carbon[c] * 0.8)
      const pi = world.occupancy[c]
      if (pi >= 0) {
        const p = world.plants[pi]
        if (p) p.alive = false
        world.occupancy[c] = -1
      }
    }
  }
}
