import { useRef, useState } from 'react';
import { applyBackup, backupFileName, createBackup, gamesToPgn, parseBackup, type Backup } from '../core/backup';
import { defaultStore } from '../core/history';
import { useServices } from './services';
import { readTextFile, saveTextFile } from './download';

/** Export / import of all local data (Settings dialog). */
export function DataManager() {
  const { history } = useServices();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const store = defaultStore();

  const exportData = async () => {
    if (!store) return setMessage({ kind: 'error', text: 'Storage is not available in this browser.' });
    const backup = createBackup(store);
    await saveTextFile(backupFileName(), JSON.stringify(backup, null, 1), 'application/json');
    setMessage({ kind: 'ok', text: `Exported ${backup.data.games.length} game(s) and your settings.` });
  };

  const exportPgn = async () => {
    const games = history.list();
    if (games.length === 0) return setMessage({ kind: 'error', text: 'There are no saved games to export yet.' });
    await saveTextFile(backupFileName(new Date(), 'pgn', 'chess-tutor-games'), gamesToPgn(games), 'application/x-chess-pgn');
    setMessage({ kind: 'ok', text: `Exported ${games.length} game(s) as PGN.` });
  };

  const onFile = async (file: File | undefined) => {
    setPending(null);
    setMessage(null);
    if (!file) return;
    let text: string;
    try {
      text = await readTextFile(file);
    } catch {
      return setMessage({ kind: 'error', text: 'Could not read the selected file.' });
    }
    const res = parseBackup(text);
    if (!res.ok) return setMessage({ kind: 'error', text: res.error });
    setPending(res.backup);
  };

  const doImport = (mode: 'merge' | 'replace') => {
    if (!pending || !store) return;
    if (mode === 'replace' && !confirm('Replace all games and settings on this device with the backup? This cannot be undone.')) return;
    // Block the running game's autosave so it cannot overwrite what we import.
    history.freeze();
    try {
      const s = applyBackup(store, pending, mode);
      const parts = [
        mode === 'merge' ? `${s.gamesAdded} new game(s) added, ${s.gamesUpdated} updated` : `${s.gamesTotal} game(s) restored`,
        s.gamesDropped ? `${s.gamesDropped} oldest game(s) skipped (limit reached)` : '',
        s.settingsApplied ? 'settings restored' : '',
        s.currentGameApplied ? 'in-progress game restored' : '',
      ].filter(Boolean);
      alert(`Import complete: ${parts.join(', ')}. The app will now reload.`);
      // Reload synchronously so the running game cannot overwrite the imported data.
      window.location.reload();
    } catch (e) {
      history.freeze(false);
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Import failed. Nothing was changed.' });
    }
  };

  return (
    <fieldset>
      <legend>Your data</legend>
      <div className="muted small">
        Games, statistics and settings are stored only on this device. Export a backup to move them to another device.
      </div>
      <div className="button-row">
        <button className="btn" onClick={exportData}>
          Export data
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Import data
        </button>
        <button className="btn" onClick={exportPgn}>
          Export all games (PGN)
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {pending && (
        <div className="import-choice">
          <div>
            Backup from {pending.exportedAt ? new Date(pending.exportedAt).toLocaleString() : 'an unknown date'} with {pending.data.games.length} game(s).
          </div>
          <div className="button-row">
            <button className="btn primary" onClick={() => doImport('merge')}>
              Merge with existing data
            </button>
            <button className="btn danger" onClick={() => doImport('replace')}>
              Replace existing data
            </button>
            <button className="btn ghost" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && <div className={message.kind === 'error' ? 'data-error' : 'data-ok'}>{message.text}</div>}
    </fieldset>
  );
}
