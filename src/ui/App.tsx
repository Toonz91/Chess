import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { GameController } from '../game/GameController';
import { DEFAULT_SETTINGS } from '../core/settings';
import type { GameRecord, Settings } from '../core/types';
import { createServices, ServicesContext, type Services } from './services';
import { PlayView } from './PlayView';
import { ReportView } from './ReportView';
import { HistoryView } from './HistoryView';
import { CoachView } from './CoachView';
import { SettingsDialog } from './SettingsDialog';

// Singletons: engine workers must not be duplicated by React StrictMode re-mounts.
let singleton: { services: Services; controller: GameController } | null = null;
function getApp() {
  if (!singleton) {
    const services = createServices();
    const settings = services.history.loadSettings(DEFAULT_SETTINGS);
    const controller = new GameController(services.service, services.history, settings);
    const saved = services.history.loadCurrent();
    if (!(saved && saved.result === '*' && controller.resume(saved, settings))) controller.newGame(settings);
    singleton = { services, controller };
  }
  return singleton;
}

type Tab = 'play' | 'report' | 'history' | 'coach';

export function App() {
  const { services, controller } = getApp();
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [tab, setTab] = useState<Tab>('play');
  const [dialog, setDialog] = useState<null | 'new-game' | 'settings'>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [games, setGames] = useState<GameRecord[]>(() => services.history.list());

  useEffect(() => {
    let alive = true;
    const timeout = setTimeout(() => alive && !engineReady && setEngineError('Stockfish is taking a long time to load. Check that public/engine contains the engine files (run npm install).'), 20000);
    services.service.whenReady().then(() => {
      if (alive) {
        setEngineReady(true);
        setEngineError(null);
      }
    });
    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, [services]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh history when a game gets saved.
  useEffect(() => {
    if (snap.savedToHistory) setGames(services.history.list());
  }, [snap.savedToHistory, snap.analyses, services]);

  useEffect(() => {
    if (tab === 'history' || tab === 'coach') setGames(services.history.list());
  }, [tab, services]);

  const currentRecord = useMemo(() => (tab === 'report' ? controller.toRecord() : null), [tab, snap, controller]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSettings = (s: Settings) => services.history.saveSettings(s);

  return (
    <ServicesContext.Provider value={services}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden>
              ♞{'︎'}
            </span>
            Chess Tutor
          </div>
          <nav className="nav">
            {(
              [
                ['play', 'Play'],
                ['report', 'Game report'],
                ['history', 'History'],
                ['coach', 'Coach'],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button key={t} className={`nav-btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </nav>
          <div className={`engine-status ${engineReady ? 'ok' : ''}`}>{engineReady ? 'Stockfish 19 ready' : 'Loading engine…'}</div>
        </header>
        {engineError && <div className="warning banner">{engineError}</div>}
        <main className="main">
          {tab === 'play' && (
            <PlayView
              controller={controller}
              engineReady={engineReady}
              onOpenReport={() => setTab('report')}
              onNewGame={() => setDialog('new-game')}
              onOpenSettings={() => setDialog('settings')}
            />
          )}
          {tab === 'report' && currentRecord && (
            currentRecord.moves.length === 0 ? (
              <div className="card muted">Play some moves first — the report of the current game appears here.</div>
            ) : (
              <>
                {snap.status === 'playing' && <div className="warning">This game is still in progress — the report covers the moves played so far.</div>}
                <ReportView game={currentRecord} />
              </>
            )
          )}
          {tab === 'history' && (
            <HistoryView
              games={games}
              onDelete={(id) => {
                services.history.remove(id);
                setGames(services.history.list());
              }}
              onClear={() => {
                services.history.clear();
                setGames([]);
              }}
            />
          )}
          {tab === 'coach' && <CoachView games={games} depth={snap.settings.analysisDepth} />}
        </main>
        {dialog && (
          <SettingsDialog
            initial={snap.settings}
            mode={dialog}
            onClose={() => setDialog(null)}
            onApply={(s) => {
              saveSettings(s);
              controller.updateSettings(s);
              setDialog(null);
            }}
            onStart={(s) => {
              if (snap.status === 'playing' && snap.moves.length > 2 && !confirm('Abandon the current game and start a new one?')) return;
              saveSettings(s);
              controller.newGame(s);
              setDialog(null);
              setTab('play');
            }}
          />
        )}
      </div>
    </ServicesContext.Provider>
  );
}
