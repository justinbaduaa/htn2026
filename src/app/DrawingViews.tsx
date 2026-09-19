import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api';
import type { CadGeometry } from '../shared/cadGeometry';
import { fmt } from '../shared/annotations';
import { renderDrawings, type PartDrawing, type SheetMeta } from './drawings';
import { loadParts } from './scene';

/**
 * Engineering views for one run: per printed part, top, front, right, and isometric renders with
 * dimensions, plus a one-page sheet to send to whoever is checking or machining it.
 */
export function DrawingViews({ parts, geometry, meta }: { parts: { name: string; url: string }[]; geometry?: CadGeometry | null; meta: SheetMeta }) {
  const { data: fetchedGeometry, error: geometryError, refetch } = useQuery({
    queryKey: ['cad-geometry', meta.projectId, meta.run],
    queryFn: () => api.geometry(meta.projectId, meta.run),
    enabled: !geometry, staleTime: Infinity,
  });
  const measuredGeometry = geometry ?? fetchedGeometry;
  const [attempt, setAttempt] = useState(0);
  const [drawings, setDrawings] = useState<PartDrawing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = parts.map(p => p.url).join('|');
  useEffect(() => {
    let cancelled = false;
    setDrawings(null); setError(null);
    if (!measuredGeometry) return;
    loadParts(parts).then(loaded => {
      if (cancelled) { loaded.forEach(part => part.geometry.dispose()); return null; }
      return renderDrawings(loaded, measuredGeometry, meta);
    })
      .then(d => { if (!cancelled) setDrawings(d); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [key, measuredGeometry, meta.projectId, meta.run, meta.title, attempt]);

  if (geometryError && !measuredGeometry) return <div role="alert"><p className="text-red-400">Could not load CAD measurements: {geometryError.message}</p><button onClick={() => void refetch()}>Retry</button></div>;
  if (!measuredGeometry) return <p role="status" className="text-neutral-400">Loading CAD measurements…</p>;
  if (error) return <div role="alert"><p className="text-red-400">Could not render the views: {error}</p><button onClick={() => setAttempt(v => v + 1)}>Retry views</button></div>;
  if (!drawings) return <p className="text-neutral-400">Rendering views</p>;
  const file = (part: string, view: string) => `${meta.projectId}-run${meta.run + 1}-${part}-${view}.png`;
  return (
    <div className="flex flex-col gap-6">
      {drawings.map(d => (
        <section key={d.part} className="flex flex-col gap-2">
          <div className="flex items-baseline gap-3">
            <h3 className="font-semibold">{d.part.replace(/_/g, ' ')}</h3>
            <span className="text-neutral-400">{fmt(d.size[0])} × {fmt(d.size[1])} × {fmt(d.size[2])} mm</span>
            <a className="ml-auto bg-white px-2 py-0.5 text-black" href={d.sheet} download={file(d.part, 'sheet')}>Download sheet</a>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {d.views.map(v => (
              <figure key={v.key} className="flex flex-col gap-1">
                <a href={v.dataUrl} target="_blank" rel="noreferrer"><img src={v.dataUrl} alt={`${v.title} view of ${d.part}`} className="w-full border border-neutral-800" /></a>
                <figcaption className="flex justify-between text-xs text-neutral-400">
                  <span>{v.title}</span>
                  <a className="underline" href={v.dataUrl} download={file(d.part, v.key)}>PNG</a>
                </figcaption>
              </figure>
            ))}
          </div>
          <details className="cad-feature-schedule"><summary>CAD measurement schedule</summary><p>All values in mm. XYZ locations are measured from this part’s minimum XYZ corner. Levels are face positions, not inferred pocket depths.</p><ul>{d.features.map((row, i) => <li key={i}>{row}</li>)}</ul></details>
          {d.notes.map(note => <p key={note} className="text-xs text-neutral-400">{note}</p>)}
        </section>
      ))}
    </div>
  );
}
