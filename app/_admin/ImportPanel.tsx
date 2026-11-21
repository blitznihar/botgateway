'use client';

import { useState } from 'react';
import styles from '../admin.module.css';

type Result = { id: string; name?: string; status: 'new' | 'exists' | 'invalid' | 'created' | 'updated' | 'skipped'; errors?: string[] };
type Response = { results?: Result[]; written?: number; invalid?: number; error?: string };

/** Import bots from a JSON file: choose file → preview (dry run) → choose skip/overwrite → import. */
export default function ImportPanel({
  existingIds,
  onClose,
  onImported,
}: {
  existingIds: string[];
  onClose: () => void;
  onImported: (message: string) => void | Promise<void>;
}) {
  const [file, setFile] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Response | null>(null);
  const [onConflict, setOnConflict] = useState<'skip' | 'overwrite'>('skip');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Response | null>(null);

  async function call(dryRun: boolean, payload: unknown): Promise<Response> {
    const res = await fetch('/api/admin/bots/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: payload, onConflict, dryRun }),
    });
    const data = (await res.json().catch(() => ({ error: `Import failed (${res.status})` }))) as Response;
    if (!res.ok && !data.results) throw new Error(data.error ?? `Import failed (${res.status})`);
    return data;
  }

  async function pick(f: File | undefined) {
    setError('');
    setPreview(null);
    setDone(null);
    if (!f) return;
    setFileName(f.name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await f.text());
    } catch (e) {
      setError(`Not valid JSON: ${(e as Error).message}`);
      return;
    }
    setFile(parsed);
    setBusy(true);
    try {
      setPreview(await call(true, parsed));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError('');
    try {
      const data = await call(false, file);
      setDone(data);
      const created = data.results?.filter((r) => r.status === 'created').length ?? 0;
      const updated = data.results?.filter((r) => r.status === 'updated').length ?? 0;
      const skipped = data.results?.filter((r) => r.status === 'skipped').length ?? 0;
      await onImported(`Imported from ${fileName}: ${created} created, ${updated} updated, ${skipped} skipped.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows = done?.results ?? preview?.results ?? [];
  const invalid = rows.filter((r) => r.status === 'invalid').length;
  const conflicts = rows.filter((r) => r.status === 'exists').length;

  return (
    <div className={styles.modalBackdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal} role="dialog" aria-label="Import bots">
        <h2>Import bots from JSON</h2>
        <p className={styles.hint}>
          Accepts a file from <em>Export</em>, a JSON array of bots, or a single bot object. Every bot is validated like the editor.
          Existing API keys are kept unless the file contains one. {existingIds.length} bots exist now.
        </p>
        <input type="file" accept="application/json,.json" aria-label="JSON file" onChange={(e) => pick(e.target.files?.[0])} />
        {error && <p className={styles.testFail} style={{ padding: '8px 12px', borderRadius: 8, marginTop: 12 }}>{error}</p>}

        {rows.length > 0 && (
          <table className={styles.importTable}>
            <thead>
              <tr>
                <th>Bot</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.id}-${i}`}>
                  <td>
                    <strong>{r.name ?? r.id}</strong>
                    <br />
                    <code>{r.id}</code>
                  </td>
                  <td>
                    <span className={`${styles.pill} ${styles[`pill_${r.status}`]}`}>
                      {r.status === 'exists' ? (onConflict === 'overwrite' ? 'will overwrite' : 'exists (skip)') : r.status}
                    </span>
                  </td>
                  <td className={styles.hint}>{r.errors?.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {preview && !done && conflicts > 0 && (
          <div className={styles.field}>
            <span className={styles.label}>{conflicts} bot(s) already exist</span>
            <label className={styles.checkbox}>
              <input type="radio" name="conflict" checked={onConflict === 'skip'} onChange={() => setOnConflict('skip')} /> Skip them (keep current)
            </label>
            <label className={styles.checkbox}>
              <input type="radio" name="conflict" checked={onConflict === 'overwrite'} onChange={() => setOnConflict('overwrite')} /> Overwrite them
            </label>
          </div>
        )}

        <div className={styles.modalActions}>
          {invalid > 0 && !done && <span className={styles.saveBarError}>Fix the {invalid} invalid bot(s) in the file first.</span>}
          {done && <span className={styles.status}>Done: {done.written} bot(s) written.</span>}
          <button type="button" className={styles.secondaryBtn} onClick={onClose}>
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && (
            <button type="button" className={styles.primaryBtn} disabled={!preview || busy || invalid > 0} onClick={commit}>
              {busy ? 'Working…' : `Import ${rows.filter((r) => r.status === 'new' || (r.status === 'exists' && onConflict === 'overwrite')).length} bot(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
