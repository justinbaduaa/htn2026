import { useEffect, useState } from 'react';
import type { Project, RequestedDimension } from '../shared/types';

type Props = {
  project: Project;
  active: string | null;
  onFocus: (id: string) => void;
  onChange: (patch: Pick<Project, 'values' | 'extra' | 'notes'>) => void;
  onAsk: (dimensionId: string, question: string) => Promise<unknown>;
  onSkip: (dimensionId: string) => void;
};

export function missingCritical(project: Project): RequestedDimension[] {
  return project.plan?.dimensions.filter(d => d.critical && project.values[d.id] == null) ?? [];
}

/**
 * Inputs are drafts in local state and save on blur or Enter. Saving on every keystroke
 * let the server refetch overwrite the field mid-typing and drop digits.
 */
export function DimensionForm({ project, active, onFocus, onChange, onAsk, onSkip }: Props) {
  const plan = project.plan!;
  const fromProject = () => Object.fromEntries(plan.dimensions.map(d => [d.id, project.values[d.id]?.toString() ?? d.default_mm?.toString() ?? '']));
  const [draft, setDraft] = useState<Record<string, string>>(fromProject);
  const [notes, setNotes] = useState(project.notes);
  useEffect(() => { setDraft(fromProject()); setNotes(project.notes); }, [project.id, plan.dimensions.length]);

  const commit = () => {
    const values: Record<string, number> = {};
    for (const [id, raw] of Object.entries(draft)) {
      const v = Number(raw);
      if (raw !== '' && !Number.isNaN(v) && v >= 0) values[id] = v;
    }
    const same = JSON.stringify(values) === JSON.stringify(project.values) && notes === project.notes;
    if (!same) onChange({ values, extra: project.extra, notes });
  };

  return (
    <div className="flex flex-col gap-2">
      {plan.dimensions.map(d => (
        <div key={d.id} className={`px-1 ${active === d.id ? 'bg-neutral-900' : ''}`}>
          <label className="grid grid-cols-[1fr_6rem] items-center gap-2">
            <span>
              {d.name}{d.critical && <span className="ml-1 text-neutral-400">required</span>}
              <span className="block text-xs text-neutral-400">{d.why}</span>
            </span>
            <input id={`dim-${d.id}`} type="number" step="0.01" inputMode="decimal" aria-label={d.name} placeholder="mm"
              value={draft[d.id] ?? ''} onFocus={e => { onFocus(d.id); e.target.select(); }} onBlur={commit}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              onChange={e => setDraft({ ...draft, [d.id]: e.target.value })}
              className="bg-neutral-900 px-2 py-1 text-right" />
          </label>
          <Clarify dimension={d} thread={project.clarifications[d.id] ?? []} onAsk={q => onAsk(d.id, q)} onOpen={() => onFocus(d.id)} onSkip={() => onSkip(d.id)} />
        </div>
      ))}
      <button type="button" className="w-fit text-neutral-400 hover:text-white" onClick={() => {
        const name = prompt('Dimension name');
        const value = Number(prompt('Value in mm'));
        if (name && value > 0) onChange({ values: project.values, extra: [...project.extra, { id: `user_${project.extra.length}`, name, kind: 'other', hole: null, value_mm: value }], notes });
      }}>+ add a measurement the model did not ask for</button>
      {project.extra.map(x => <div key={x.id} className="px-1 text-neutral-400">{x.name}: {x.value_mm} mm</div>)}
      <textarea value={notes} placeholder="Notes for the next generation, e.g. holes were 0.5 mm too far apart"
        onChange={e => setNotes(e.target.value)} onBlur={commit}
        className="mt-2 min-h-20 bg-neutral-900 p-2" />
    </div>
  );
}

/** Q&A thread under one dimension. "Unclear?" opens a one-line question box; answers stay under the field. */
function Clarify({ dimension, thread, onAsk, onOpen, onSkip }: { dimension: RequestedDimension; thread: { question: string; answer: string }[]; onAsk: (q: string) => Promise<unknown>; onOpen: () => void; onSkip: () => void }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!question.trim()) return;
    setPending(true); setError(null);
    try { await onAsk(question.trim()); setQuestion(''); setOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPending(false); }
  };
  return (
    <div className="text-xs">
      {thread.map((t, i) => (
        <div key={i} className="mt-1 border-l border-neutral-700 pl-2">
          <div className="text-neutral-400">Q: {t.question}</div>
          <div>{t.answer}</div>
        </div>
      ))}
      {open ? (
        <div className="mt-1 flex gap-2">
          <input autoFocus value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void send(); if (e.key === 'Escape') setOpen(false); }}
            placeholder={`What is unclear about "${dimension.name}"?`} className="flex-1 bg-neutral-900 px-2 py-1" disabled={pending} />
          <button type="button" onClick={() => void send()} disabled={pending || !question.trim()} className="bg-white px-2 text-black disabled:opacity-40">{pending ? 'Asking' : 'Ask'}</button>
        </div>
      ) : (
        <span className="flex gap-3">
          <button type="button" onClick={() => { setOpen(true); onOpen(); }} className="text-neutral-500 hover:text-white">Unclear? Ask about this measurement</button>
          {dimension.critical && <button type="button" onClick={onSkip} className="text-neutral-500 hover:text-white">Doesn't apply, skip</button>}
        </span>
      )}
      {error && <div className="text-red-400">{error}</div>}
    </div>
  );
}
