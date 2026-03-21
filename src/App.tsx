import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from './ui/Sidebar'
import { Viewport } from './view/Viewport'
import { useSimStore } from './state/store'
import { createDefaultProject } from './sim/project'
import { ErrorBoundary } from './ui/ErrorBoundary'

export function App() {
  const [booted, setBooted] = useState(false)
  const initFromProject = useSimStore((s) => s.initFromProject)
  const tick = useSimStore((s) => s.tick)
  const isRunning = useSimStore((s) => s.isRunning)
  const speed = useSimStore((s) => s.speed)

  const project = useMemo(() => createDefaultProject(), [])

  useEffect(() => {
    if (booted) return
    initFromProject(project)
    setBooted(true)
  }, [booted, initFromProject, project])

  useEffect(() => {
    if (!isRunning) return
    let raf = 0
    let last = performance.now()
    const loop = (t: number) => {
      const dtMs = Math.min(50, Math.max(0, t - last))
      last = t
      tick((dtMs / 1000) * speed)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [isRunning, speed, tick])

  return (
    <ErrorBoundary>
      <div className="app">
        <div className="sidebar">
          <Sidebar />
        </div>
        <div className="viewport">
          <Viewport />
        </div>
      </div>
    </ErrorBoundary>
  )
}
