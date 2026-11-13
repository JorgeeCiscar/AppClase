import { useCallback, useEffect, useState } from 'react'
import type { Settings } from '../../shared/types'
import Dashboard from './components/Dashboard'
import DeliverablesView from './components/DeliverablesView'
import SearchView from './components/SearchView'
import SettingsView from './components/SettingsView'
import SubjectDetail from './components/SubjectDetail'
import SubjectsView from './components/SubjectsView'

type View =
  | { name: 'dashboard' }
  | { name: 'subjects' }
  | { name: 'subject'; id: number }
  | { name: 'deliverables' }
  | { name: 'search'; q?: string }
  | { name: 'settings' }

const NAV: [View['name'], string][] = [
  ['dashboard', 'Panel'],
  ['subjects', 'Asignaturas'],
  ['deliverables', 'Entregas'],
  ['search', 'Buscar'],
  ['settings', 'Ajustes']
]

export default function App() {
  const [view, setView] = useState<View>({ name: 'dashboard' })
  const [settings, setSettings] = useState<Settings>({ course_name: '1º DAW', openers: [] })
  const [toast, setToast] = useState<{ msg: string; bad: boolean } | null>(null)
  const [version, setVersion] = useState('')

  const showToast = useCallback((msg: string, bad = false) => {
    setToast({ msg, bad })
    setTimeout(() => setToast(null), bad ? 6000 : 3000)
  }, [])

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    void window.api.app.version().then(setVersion)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setView({ name: 'search' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const active = view.name === 'subject' ? 'subjects' : view.name

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          App<span className="brand-mark">Clase</span>
        </div>
        <div className="brand-sub">{settings.course_name}</div>
        <nav>
          {NAV.map(([name, label]) => (
            <button
              key={name}
              className={active === name ? 'active' : ''}
              onClick={() => setView({ name } as View)}
            >
              {label}
              {name === 'search' && <span className="count">Ctrl+K</span>}
            </button>
          ))}
        </nav>
        <div className="version">{version && `v${version}`}</div>
      </aside>

      <main className="content">
        {view.name === 'dashboard' && (
          <Dashboard openers={settings.openers} onToast={showToast} courseName={settings.course_name} />
        )}
        {view.name === 'subjects' && <SubjectsView onOpen={(id) => setView({ name: 'subject', id })} />}
        {view.name === 'subject' && (
          <SubjectDetail
            subjectId={view.id}
            openers={settings.openers}
            onToast={showToast}
            onBack={() => setView({ name: 'subjects' })}
          />
        )}
        {view.name === 'deliverables' && <DeliverablesView openers={settings.openers} onToast={showToast} />}
        {view.name === 'search' && (
          <SearchView
            initialQuery={view.q}
            openers={settings.openers}
            onToast={showToast}
            onOpenSubject={(id) => setView({ name: 'subject', id })}
          />
        )}
        {view.name === 'settings' && <SettingsView onSaved={setSettings} onToast={showToast} />}
      </main>

      {toast && <div className={`toast${toast.bad ? ' bad' : ''}`}>{toast.msg}</div>}
    </div>
  )
}
