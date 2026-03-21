import { useMemo, useState } from 'react'
import { useSimStore } from '../state/store'
import type { SpeciesConfig } from '../sim/types'
import { quantizeSensorCost } from '../sim/sensors'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type Tab = 'Terreno' | 'Specie' | 'Sensori' | 'AI' | 'Metriche'

export function Sidebar() {
  const [tab, setTab] = useState<Tab>('Terreno')

  return (
    <div>
      <div className="brand">
        <div className="brand-badge" />
        <div>
          <h1>Digital Twin Forestale</h1>
          <div className="sub">Simulazione 3D parametrica per rigenerazione naturale</div>
        </div>
      </div>

      <Controls />

      <div className="tabs">
        {(['Terreno', 'Specie', 'Sensori', 'AI', 'Metriche'] as Tab[]).map((t) => (
          <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </div>
        ))}
      </div>

      {tab === 'Terreno' && <TerrainTab />}
      {tab === 'Specie' && <SpeciesTab />}
      {tab === 'Sensori' && <SensorsTab />}
      {tab === 'AI' && <AiTab />}
      {tab === 'Metriche' && <MetricsTab />}
    </div>
  )
}

function Controls() {
  const isRunning = useSimStore((s) => s.isRunning)
  const setRunning = useSimStore((s) => s.setRunning)
  const speed = useSimStore((s) => s.speed)
  const setSpeed = useSimStore((s) => s.setSpeed)
  const budget = useSimStore((s) => s.budgetCredits)
  const spent = useSimStore((s) => s.spentCredits)
  const autoMode = useSimStore((s) => s.autoMode)
  const setAutoMode = useSimStore((s) => s.setAutoMode)

  const remaining = Math.max(0, budget - spent)

  return (
    <div className="card">
      <h2>Controlli</h2>
      <div className="kv">
        <div className="pill">
          <div className="k">Budget</div>
          <div className="v">{budget.toLocaleString()} cr</div>
        </div>
        <div className="pill">
          <div className="k">Residuo</div>
          <div className="v">{remaining.toLocaleString()} cr</div>
        </div>
      </div>
      <div className="row">
        <label>Simulazione</label>
        <button className="btn primary" onClick={() => setRunning(!isRunning)}>
          {isRunning ? 'Pausa' : 'Avvia'}
        </button>
      </div>
      <div className="row">
        <label>Velocita (giorni/s)</label>
        <input type="number" value={speed} min={0} max={365} step={1} onChange={(e) => setSpeed(Number(e.target.value))} />
      </div>
      <div className="row">
        <label>Modalita automatica</label>
        <input type="checkbox" checked={autoMode} onChange={(e) => setAutoMode(e.target.checked)} />
      </div>
      <div className="small">In automatico, l’AI prova a proporre e approvare sensori/interventi rispettando budget e vincolo dati (niente interventi fuori copertura sensori).</div>
    </div>
  )
}

function TerrainTab() {
  const project = useSimStore((s) => s.project)
  const updateTerrain = useSimStore((s) => s.updateTerrain)
  const updateClimate = useSimStore((s) => s.updateClimate)
  const regenerateTerrain = useSimStore((s) => s.regenerateTerrain)
  const overlayMode = useSimStore((s) => s.overlayMode)
  const setOverlayMode = useSimStore((s) => s.setOverlayMode)
  const showRoots = useSimStore((s) => s.showRoots)
  const setShowRoots = useSimStore((s) => s.setShowRoots)
  const assisted = useSimStore((s) => s.assistedColonization)
  const setAssisted = useSimStore((s) => s.setAssistedColonization)

  if (!project) return null
  const t = project.terrain
  const c = project.climate

  return (
    <div className="card">
      <h2>Ambiente / Terreno</h2>
      <div className="row">
        <label>Tipologia suolo</label>
        <select value={t.baseSoil} onChange={(e) => updateTerrain({ baseSoil: e.target.value as any })}>
          <option value="sabbioso">Sabbioso</option>
          <option value="argilloso">Argilloso</option>
          <option value="limoso">Limoso</option>
          <option value="roccioso">Rocccioso</option>
          <option value="misto">Misto</option>
        </select>
      </div>

      <div className="row">
        <label>Umidita media (%)</label>
        <input type="number" value={t.meanMoisturePct} min={0} max={100} step={1} onChange={(e) => updateTerrain({ meanMoisturePct: Number(e.target.value) })} />
      </div>

      <div className="row">
        <label>Azoto (N)</label>
        <input type="number" value={t.nutrients.n} min={0} max={200} step={1} onChange={(e) => updateTerrain({ nutrients: { ...t.nutrients, n: Number(e.target.value) } })} />
      </div>
      <div className="row">
        <label>Fosforo (P)</label>
        <input type="number" value={t.nutrients.p} min={0} max={200} step={1} onChange={(e) => updateTerrain({ nutrients: { ...t.nutrients, p: Number(e.target.value) } })} />
      </div>
      <div className="row">
        <label>Potassio (K)</label>
        <input type="number" value={t.nutrients.k} min={0} max={200} step={1} onChange={(e) => updateTerrain({ nutrients: { ...t.nutrients, k: Number(e.target.value) } })} />
      </div>

      <div className="row">
        <label>pH suolo</label>
        <input type="number" value={t.ph} min={4} max={9} step={0.1} onChange={(e) => updateTerrain({ ph: Number(e.target.value) })} />
      </div>

      <div className="row">
        <label>Temp media (C)</label>
        <input type="number" value={t.meanTempC} min={-10} max={35} step={0.5} onChange={(e) => updateTerrain({ meanTempC: Number(e.target.value) })} />
      </div>
      <div className="row">
        <label>Variazioni stagionali (C)</label>
        <input type="number" value={t.seasonalTempAmpC} min={0} max={20} step={0.5} onChange={(e) => updateTerrain({ seasonalTempAmpC: Number(e.target.value) })} />
      </div>

      <div className="row">
        <label>Altitudine min/max (m)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="number"
            value={t.altitudeMinM}
            min={0}
            max={2000}
            step={1}
            onChange={(e) => updateTerrain({ altitudeMinM: Number(e.target.value) })}
          />
          <input
            type="number"
            value={t.altitudeMaxM}
            min={0}
            max={4000}
            step={1}
            onChange={(e) => updateTerrain({ altitudeMaxM: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="row">
        <label>Rugosita topografia (0..1)</label>
        <input type="number" value={t.roughness} min={0} max={1} step={0.05} onChange={(e) => updateTerrain({ roughness: Number(e.target.value) })} />
      </div>
      <div className="row">
        <label>Micro-ombre (0..1)</label>
        <input
          type="number"
          value={t.shadePatchiness}
          min={0}
          max={1}
          step={0.05}
          onChange={(e) => updateTerrain({ shadePatchiness: Number(e.target.value) })}
        />
      </div>

      <div style={{ marginTop: 10 }} className="pill">
        <div className="k">Clima (eventi casuali)</div>
        <div className="row">
          <label>Pioggia media (mm/g)</label>
          <input type="number" value={c.meanRainMmDay} min={0} max={20} step={0.1} onChange={(e) => updateClimate({ meanRainMmDay: Number(e.target.value) })} />
        </div>
        <div className="row">
          <label>Vento medio (0..1)</label>
          <input type="number" value={c.windMean} min={0} max={1} step={0.05} onChange={(e) => updateClimate({ windMean: Number(e.target.value) })} />
        </div>
        <div className="row">
          <label>Prob siccita /giorno</label>
          <input
            type="number"
            value={c.droughtChancePerDay}
            min={0}
            max={0.1}
            step={0.001}
            onChange={(e) => updateClimate({ droughtChancePerDay: Number(e.target.value) })}
          />
        </div>
        <div className="row">
          <label>Prob tempesta /giorno</label>
          <input
            type="number"
            value={c.stormChancePerDay}
            min={0}
            max={0.1}
            step={0.001}
            onChange={(e) => updateClimate({ stormChancePerDay: Number(e.target.value) })}
          />
        </div>
        <div className="row">
          <label>Prob incendio /giorno</label>
          <input
            type="number"
            value={c.wildfireChancePerDay}
            min={0}
            max={0.05}
            step={0.0005}
            onChange={(e) => updateClimate({ wildfireChancePerDay: Number(e.target.value) })}
          />
        </div>
        <div className="row">
          <label>Prob malattia /giorno</label>
          <input
            type="number"
            value={c.diseaseChancePerDay}
            min={0}
            max={0.05}
            step={0.0005}
            onChange={(e) => updateClimate({ diseaseChancePerDay: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="row">
        <label>Overlay</label>
        <select value={overlayMode} onChange={(e) => setOverlayMode(e.target.value as any)}>
          <option value="coverage">Copertura sensori (dati mancanti)</option>
          <option value="moisture">Umidita</option>
          <option value="nutrients_n">Azoto (N)</option>
          <option value="nutrients_p">Fosforo (P)</option>
          <option value="nutrients_k">Potassio (K)</option>
          <option value="carbon">Carbonio nel suolo</option>
          <option value="ph">pH</option>
          <option value="biodiversity">Biodiversita</option>
          <option value="invasive">Specie invasive</option>
          <option value="fire">Rischio incendi</option>
          <option value="none">Nessuno</option>
        </select>
      </div>

      <div className="row">
        <label>Mostra radici</label>
        <input type="checkbox" checked={showRoots} onChange={(e) => setShowRoots(e.target.checked)} />
      </div>
      <div className="row">
        <label>Colonizzazione assistita (AI)</label>
        <input type="checkbox" checked={assisted} onChange={(e) => setAssisted(e.target.checked)} />
      </div>

      <div className="btnrow">
        <button className="btn danger" onClick={() => regenerateTerrain()}>
          Rigenera terreno
        </button>
      </div>
      <div className="small">Nota: modifiche al terreno aggiornano i parametri di base; la rigenerazione ricrea topografia e patch degradate.</div>
    </div>
  )
}

function SpeciesTab() {
  const project = useSimStore((s) => s.project)
  const addSpecies = useSimStore((s) => s.addSpecies)
  const updateSpecies = useSimStore((s) => s.updateSpecies)
  const removeSpecies = useSimStore((s) => s.removeSpecies)
  const [open, setOpen] = useState<string | null>(null)

  if (!project) return null

  const createNew = () => {
    const base: SpeciesConfig = {
      id: `spec_${Math.random().toString(16).slice(2, 8)}`,
      name: 'Nuova specie',
      form: 'latifoglia',
      maxHeightM: 10,
      maxTrunkRadiusM: 0.18,
      maxCanopyRadiusM: 3,
      rootDepthM: 1.8,
      waterUsePerDay: 0.5,
      nutrientUsePerDay: { n: 0.3, p: 0.2, k: 0.25 },
      seed: { distanceM: 18, probabilityPerDay: 0.03, minMoisturePct: 25, phMin: 5, phMax: 8 },
      tolerance: { tempMinC: -10, tempMaxC: 36, drought: 0.5, phMin: 4.5, phMax: 8.5 },
      germinationDays: 14,
      maturityDays: 1500,
      shadePreference: 0.4,
      color: { canopy: '#2f8b57', trunk: '#5a4636' },
    }
    addSpecies(base)
    setOpen(base.id)
  }

  return (
    <div className="card">
      <h2>Specie Vegetali</h2>
      <div className="small">Definisci piu specie. L’AI usa le tolleranze (pH/temperatura/siccita) e le richieste (acqua/nutrienti) per scegliere la piu adatta nelle aree vuote.</div>
      <div className="btnrow">
        <button className="btn primary" onClick={createNew}>
          Aggiungi specie
        </button>
      </div>
      <div style={{ marginTop: 10 }}>
        {project.species.map((s) => (
          <div key={s.id} className="pill" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div>
                <div className="k">{s.id}</div>
                <div className="v" style={{ fontFamily: 'var(--ui)' }}>
                  {s.name}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setOpen(open === s.id ? null : s.id)}>
                  {open === s.id ? 'Chiudi' : 'Modifica'}
                </button>
                <button className="btn danger" onClick={() => removeSpecies(s.id)}>
                  Rimuovi
                </button>
              </div>
            </div>
            {open === s.id && (
              <div style={{ marginTop: 10 }}>
                <SpeciesEditor s={s} onChange={(p) => updateSpecies(s.id, p)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function SpeciesEditor({ s, onChange }: { s: SpeciesConfig; onChange: (p: Partial<SpeciesConfig>) => void }) {
  return (
    <div>
      <div className="row">
        <label>Nome</label>
        <input value={s.name} onChange={(e) => onChange({ name: e.target.value })} />
      </div>
      <div className="row">
        <label>Forma</label>
        <select value={s.form} onChange={(e) => onChange({ form: e.target.value as any })}>
          <option value="latifoglia">Albero (latifoglia)</option>
          <option value="conifera">Albero (conifera)</option>
          <option value="arbusto">Arbusto</option>
        </select>
      </div>
      <div className="row">
        <label>H max (m)</label>
        <input type="number" value={s.maxHeightM} min={0.5} max={80} step={0.5} onChange={(e) => onChange({ maxHeightM: Number(e.target.value) })} />
      </div>
      <div className="row">
        <label>Chioma max (m)</label>
        <input
          type="number"
          value={s.maxCanopyRadiusM}
          min={0.2}
          max={20}
          step={0.2}
          onChange={(e) => onChange({ maxCanopyRadiusM: Number(e.target.value) })}
        />
      </div>
      <div className="row">
        <label>Radici (m)</label>
        <input type="number" value={s.rootDepthM} min={0.1} max={10} step={0.1} onChange={(e) => onChange({ rootDepthM: Number(e.target.value) })} />
      </div>
      <div className="row">
        <label>Consumo acqua (0..1)</label>
        <input
          type="number"
          value={s.waterUsePerDay}
          min={0}
          max={1}
          step={0.05}
          onChange={(e) => onChange({ waterUsePerDay: Number(e.target.value) })}
        />
      </div>
      <div className="row">
        <label>Semi: distanza (m)</label>
        <input
          type="number"
          value={s.seed.distanceM}
          min={1}
          max={80}
          step={1}
          onChange={(e) => onChange({ seed: { ...s.seed, distanceM: Number(e.target.value) } })}
        />
      </div>
      <div className="row">
        <label>Semi: prob/giorno</label>
        <input
          type="number"
          value={s.seed.probabilityPerDay}
          min={0}
          max={0.2}
          step={0.005}
          onChange={(e) => onChange({ seed: { ...s.seed, probabilityPerDay: Number(e.target.value) } })}
        />
      </div>
      <div className="row">
        <label>Tolleranza pH (min/max)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="number"
            value={s.tolerance.phMin}
            min={4}
            max={9}
            step={0.1}
            onChange={(e) => onChange({ tolerance: { ...s.tolerance, phMin: Number(e.target.value) } })}
          />
          <input
            type="number"
            value={s.tolerance.phMax}
            min={4}
            max={9}
            step={0.1}
            onChange={(e) => onChange({ tolerance: { ...s.tolerance, phMax: Number(e.target.value) } })}
          />
        </div>
      </div>
      <div className="row">
        <label>Siccita (0..1)</label>
        <input
          type="number"
          value={s.tolerance.drought}
          min={0}
          max={1}
          step={0.05}
          onChange={(e) => onChange({ tolerance: { ...s.tolerance, drought: Number(e.target.value) } })}
        />
      </div>
      <div className="row">
        <label>Preferenza ombra (0..1)</label>
        <input type="number" value={s.shadePreference} min={0} max={1} step={0.05} onChange={(e) => onChange({ shadePreference: Number(e.target.value) })} />
      </div>
    </div>
  )
}

function SensorsTab() {
  const world = useSimStore((s) => s.world)
  const sensors = useSimStore((s) => s.sensors)
  const spent = useSimStore((s) => s.spentCredits)
  const budget = useSimStore((s) => s.budgetCredits)
  const suggestions = useSimStore((s) => s.suggestions)
  const requestSensorPlan = useSimStore((s) => s.requestSensorPlan)
  const approveSensorPlan = useSimStore((s) => s.approveSensorPlan)
  const rejectSuggestion = useSimStore((s) => s.rejectSuggestion)
  const beginPlaceSensor = useSimStore((s) => s.beginPlaceSensor)
  const placingSensor = useSimStore((s) => s.placingSensor)
  const cancelPlaceSensor = useSimStore((s) => s.cancelPlaceSensor)
  const removeSensor = useSimStore((s) => s.removeSensor)

  const remaining = Math.max(0, budget - spent)
  const sensorPlans = suggestions.filter((s) => s.kind === 'sensor_plan') as any[]

  const manualCost = placingSensor ? quantizeSensorCost(placingSensor.type, placingSensor.precision, placingSensor.radiusM) : 0

  return (
    <div className="card">
      <h2>Sensori</h2>
      <div className="small">
        I dati esistono solo nelle aree coperte dai sensori. L’AI non puo intervenire dove mancano misure. Usa “Consiglia posizionamento” per una proposta ottimizzata,
        poi approva manualmente.
      </div>

      <div className="btnrow">
        <button className="btn primary" onClick={() => requestSensorPlan()} disabled={!world}>
          Consiglia posizionamento (AI)
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        <div className="pill">
          <div className="k">Posizionamento manuale</div>
          <div className="v" style={{ fontFamily: 'var(--ui)' }}>
            {placingSensor ? `Clicca sulla mappa 3D per piazzare (${placingSensor.type}, costo ${manualCost} cr)` : 'Seleziona tipo e clicca in scena'}
          </div>
          <div className="btnrow">
            <button className="btn" onClick={() => beginPlaceSensor('suolo')} disabled={!!placingSensor || remaining < 1}>
              Suolo
            </button>
            <button className="btn" onClick={() => beginPlaceSensor('clima')} disabled={!!placingSensor || remaining < 1}>
              Clima
            </button>
            <button className="btn" onClick={() => beginPlaceSensor('biodiversita')} disabled={!!placingSensor || remaining < 1}>
              Biodiversita
            </button>
            <button className="btn danger" onClick={() => cancelPlaceSensor()} disabled={!placingSensor}>
              Annulla
            </button>
          </div>
        </div>
      </div>

      {sensorPlans.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="pill">
            <div className="k">Piani AI</div>
            {sensorPlans.map((p) => (
              <div key={p.id} style={{ marginTop: 8 }}>
                <div className="v" style={{ fontFamily: 'var(--ui)' }}>
                  {p.sensors.length} sensori proposti, costo {p.totalCost} cr
                </div>
                <div className="btnrow">
                  <button className="btn primary" onClick={() => approveSensorPlan(p.id)}>
                    Approva
                  </button>
                  <button className="btn" onClick={() => rejectSuggestion(p.id, 'Piano sensori rifiutato')}>
                    Rifiuta
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <div className="pill">
          <div className="k">Sensori attivi</div>
          <div className="v" style={{ fontFamily: 'var(--ui)' }}>
            {sensors.length === 0 ? 'Nessun sensore installato (AI blocca interventi).' : `${sensors.length} sensori`}
          </div>
          {sensors.slice(0, 18).map((s) => (
            <div key={s.id} className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
              <span>
                {s.type} | r={Math.round(s.radiusM)}m | prec={s.precision.toFixed(2)} | costo={s.cost} cr
              </span>
              <button className="btn" onClick={() => removeSensor(s.id)}>
                Rimuovi
              </button>
            </div>
          ))}
          {sensors.length > 18 && <div className="small">… e altri {sensors.length - 18}</div>}
        </div>
      </div>
    </div>
  )
}

function AiTab() {
  const suggestions = useSimStore((s) => s.suggestions)
  const pendingInterventions = useSimStore((s) => s.pendingInterventions)
  const requestInterventions = useSimStore((s) => s.requestInterventions)
  const rejectSuggestion = useSimStore((s) => s.rejectSuggestion)
  const approveIntervention = useSimStore((s) => s.approveIntervention)
  const rejectIntervention = useSimStore((s) => s.rejectIntervention)

  const interventionSugs = suggestions.filter((s) => s.kind === 'intervention') as any[]

  return (
    <div className="card">
      <h2>Azioni / Interventi</h2>
      <div className="btnrow">
        <button className="btn primary" onClick={() => requestInterventions()}>
          Suggerisci interventi (AI)
        </button>
      </div>
      <div className="small">Suggerimenti AI richiedono approvazione manuale (a meno di modalita automatica). Vincolo: nessun intervento in aree senza sensori.</div>

      {interventionSugs.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="pill">
            <div className="k">Suggerimenti AI</div>
            {interventionSugs.map((s) => (
              <div key={s.id} style={{ marginTop: 8 }}>
                <div className="v" style={{ fontFamily: 'var(--ui)' }}>
                  {s.intervention.type} | costo {s.intervention.cost} cr
                </div>
                <div className="btnrow">
                  <button
                    className="btn primary"
                    onClick={() => {
                      const it = { ...s.intervention, id: `int_${Math.random().toString(16).slice(2)}` }
                      useSimStore.setState({ pendingInterventions: [it, ...useSimStore.getState().pendingInterventions] })
                      rejectSuggestion(s.id, 'Suggerimento convertito in intervento pendente (in attesa di approvazione).')
                    }}
                  >
                    Porta in approvazione
                  </button>
                  <button className="btn" onClick={() => rejectSuggestion(s.id, 'Intervento rifiutato')}>
                    Rifiuta
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingInterventions.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="pill">
            <div className="k">In approvazione</div>
            {pendingInterventions.slice(0, 12).map((it) => (
              <div key={it.id} style={{ marginTop: 8 }}>
                <div className="v" style={{ fontFamily: 'var(--ui)' }}>
                  {it.type} | costo {it.cost} cr
                </div>
                <div className="btnrow">
                  <button className="btn primary" onClick={() => approveIntervention(it.id)}>
                    Approva
                  </button>
                  <button className="btn" onClick={() => rejectIntervention(it.id, 'Rifiutato dall’utente')}>
                    Rifiuta
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingInterventions.length === 0 && interventionSugs.length === 0 && <div className="small" style={{ marginTop: 10 }}>Nessun intervento in coda.</div>}
    </div>
  )
}

function MetricsTab() {
  const metrics = useSimStore((s) => s.metrics)
  const logs = useSimStore((s) => s.logs)
  const world = useSimStore((s) => s.world)

  const data = useMemo(() => metrics.slice(-220), [metrics])
  const last = data[data.length - 1]

  return (
    <div>
      <div className="card">
        <h2>Output / Metriche</h2>
        {last && (
          <div className="kv">
            <div className="pill">
              <div className="k">Copertura vegetale</div>
              <div className="v">{(last.vegetativeCover * 100).toFixed(1)}%</div>
            </div>
            <div className="pill">
              <div className="k">Biodiversita</div>
              <div className="v">{(last.biodiversity * 100).toFixed(1)}%</div>
            </div>
            <div className="pill">
              <div className="k">Carbon storage</div>
              <div className="v">{Math.round(last.carbonStorage).toLocaleString()} kgC</div>
            </div>
            <div className="pill">
              <div className="k">Rigenerazione degradata</div>
              <div className="v">{(last.degradedRegen * 100).toFixed(1)}%</div>
            </div>
          </div>
        )}

        <div style={{ height: 190, marginTop: 12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis dataKey="day" tick={{ fill: '#a9b9b2', fontSize: 11 }} />
              <YAxis tick={{ fill: '#a9b9b2', fontSize: 11 }} domain={[0, 1]} />
              <Tooltip contentStyle={{ background: '#0f1614', border: '1px solid #24332e', borderRadius: 10, fontSize: 12 }} />
              <Line type="monotone" dataKey="vegetativeCover" stroke="#63d2a3" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="biodiversity" stroke="#f5c66a" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="small">Grafico: copertura vegetale e biodiversita nel tempo (normalizzati 0..1).</div>
      </div>

      <div className="card">
        <h2>Registro Eventi</h2>
        <div className="log">
          {logs
            .slice(-80)
            .reverse()
            .map((l) => `${String(l.day).padStart(4, ' ')} | ${l.type.padEnd(22, ' ')} | ${l.message}`)
            .join('\n')}
        </div>
        {world && <div className="small" style={{ marginTop: 8 }}>Giorno simulazione: {world.day.toFixed(1)}</div>}
      </div>
    </div>
  )
}
