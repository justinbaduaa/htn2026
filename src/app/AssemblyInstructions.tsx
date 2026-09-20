import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api';
import type { CadGeometry } from '../shared/cadGeometry';
import type { Project, Run } from '../shared/types';
import { planAssembly, type AssemblyPlan } from './assembly';
import { renderAssemblyPages, PAGE_H, PAGE_W, type AssemblyPage } from './assemblyPages';
import { loadParts } from './scene';

/**
 * IKEA-style assembly booklet for one run: a parts page, then one wordless-first page per step with the
 * exploded parts, arrows to their seats and hardware callouts. Everything is derived from the exported
 * solids and the run's measurements; no model call.
 */
export function AssemblyInstructions({ project, run, parts, geometry }: { project: Project; run: Run; parts: { name: string; url: string }[]; geometry: CadGeometry }) {
  const { data: dims } = useQuery({ queryKey: ['dims', project.id, run.n], queryFn: () => api.dims(project.id, run.n).catch(() => null), staleTime: Infinity });
  const [pages, setPages] = useState<AssemblyPage[] | null>(null);
  const [plan, setPlan] = useState<AssemblyPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = parts.map(p => p.url).join('|');
  useEffect(() => {
    if (dims === undefined) return;   // still loading the run's readings
    let cancelled = false;
    setPages(null); setError(null);
    let assembly: AssemblyPlan;
    try { assembly = planAssembly(geometry, project.plan, dims); setPlan(assembly); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    loadParts(parts).then(loaded => {
      if (cancelled) { loaded.forEach(p => p.geometry.dispose()); return null; }
      return renderAssemblyPages(loaded, assembly, { title: project.title }).finally(() => loaded.forEach(p => p.geometry.dispose()));
    })
      .then(p => { if (!cancelled && p) setPages(p); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [key, geometry, dims, project.plan, project.title, attempt]);

  const file = (page: AssemblyPage) => `${project.id}-run${run.n + 1}-assembly-${page.key}.png`;
  const printBooklet = () => {
    if (!pages) return;
    const w = window.open('', '_blank'); if (!w) return;
    w.document.write(`<!doctype html><title>${project.title} · assembly instructions</title><style>@page{size:A4 portrait;margin:8mm}body{margin:0}img{display:block;width:100%;page-break-after:always;break-after:page}img:last-child{page-break-after:auto}</style>${pages.map(p => `<img src="${p.dataUrl}" alt="${p.title}">`).join('')}`);
    w.document.close(); w.focus();
    setTimeout(() => w.print(), 300);
  };
  const downloadAll = () => {
    if (!pages) return;
    const canvas = document.createElement('canvas'); canvas.width = PAGE_W; canvas.height = PAGE_H * pages.length;
    const ctx = canvas.getContext('2d')!;
    Promise.all(pages.map(p => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = p.dataUrl; })))
      .then(images => { images.forEach((img, i) => ctx.drawImage(img, 0, i * PAGE_H)); const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `${project.id}-run${run.n + 1}-assembly.png`; a.click(); });
  };

  if (error) return <div role="alert"><p className="text-red-400">Could not build the assembly instructions: {error}</p><button onClick={() => setAttempt(v => v + 1)}>Retry</button></div>;
  if (!pages || !plan) return <p role="status" className="text-neutral-400">Drawing assembly instructions…</p>;
  return (
    <div className="assembly-booklet">
      <div className="assembly-toolbar">
        <span>{plan.steps.length} steps · {plan.screws.length} × M{plan.hardware.thread} × {plan.hardware.screwLength} mm screws{plan.hardware.hasNuts ? ` · ${plan.screws.length} × M${plan.hardware.thread} nuts` : ''}</span>
        <div className="cad-toolbar-group">
          <button type="button" onClick={printBooklet}>Print booklet</button>
          <button type="button" onClick={downloadAll}>Download all pages</button>
        </div>
      </div>
      <ol className="assembly-pages">
        {pages.map(p => (
          <li key={p.key} className="assembly-page">
            <a href={p.dataUrl} target="_blank" rel="noreferrer"><img src={p.dataUrl} alt={`${p.title} of the assembly instructions`} width={PAGE_W} height={PAGE_H} /></a>
            <div className="assembly-page-caption"><span>{p.title}</span><a className="underline" href={p.dataUrl} download={file(p)}>PNG</a></div>
          </li>
        ))}
      </ol>
    </div>
  );
}
