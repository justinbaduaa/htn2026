import { useEffect, useState } from 'react';
import type { DimensionPriority, Project, RequestedDimension } from '../shared/types';

/** What the photo should light up: one reading, or every reading of a group. */
export type Target = { ids: string[]; label: string };

type Props = {
  project: Project;
  active: Target | null;
  onFocus: (target: Target | null) => void;
  onHover: (target: Target | null) => void;
  onChange: (patch: Pick<Project, 'values' | 'extra' | 'notes'>) => void;
  onAsk: (dimensionId: string, question: string) => Promise<unknown>;
  onSkipped: (ids: string[]) => void;   // the full new skipped list
};

export function missingRequired(project: Project): RequestedDimension[] {
  const skipped = new Set(project.skipped);
  return project.plan?.dimensions.filter(d => d.priority === 'required' && !skipped.has(d.id) && project.values[d.id] == null) ?? [];
}

type Group = { key: string; label: string; dims: RequestedDimension[] };
const tiers: { priority: DimensionPriority; title: string; note: string }[] = [
  { priority: 'required', title: 'Required for fit', note: 'Generate unlocks once each of these is measured or skipped.' },
  { priority: 'recommended', title: 'Recommended', note: 'Openings and clearances. Left blank, the model uses its own estimate from the photos with extra clearance. Skip what you do not care about.' },
  { priority: 'optional', title: 'Optional', note: 'Cosmetic. Defaults are used unless you change them.' },
];

/** One tier's readings grouped by feature label in first-seen order. A standalone reading is its own group. */
function groupsOf(dims: RequestedDimension[], priority: DimensionPriority): Group[] {
  const out: Group[] = [];
  for (const d of dims) {
    if (d.priority !== priority) continue;
    const label = d.group ?? d.name;
    const key = `${priority}:${label}`;
    let g = out.find(x => x.key === key);
    if (!g) { g = { key, label, dims: [] }; out.push(g); }
    g.dims.push(d);
  }
  return out;
}

/**
 * Readings sorted most to least relevant: three tiers, each a list of collapsible feature groups.
 * Clicking a group lights every one of its callouts on the photo; clicking a field lights just that one.
 * Inputs are drafts in local state and save on blur or Enter. Saving on every keystroke let the
 * server refetch overwrite the field mid-typing and drop digits.
 */
export function DimensionForm({ project, active, onFocus, onHover, onChange, onAsk, onSkipped }: Props) {
  const plan = project.plan!;
  const skipped = new Set(project.skipped);
  // A required reading must come from the calipers, so a model default is only a placeholder hint there.
  const fromProject = () => Object.fromEntries(plan.dimensions.map(d => [d.id, project.values[d.id]?.toString() ?? (d.priority === 'required' ? '' : d.default_mm?.toString() ?? '')]));
  const [draft, setDraft] = useState<Record<string, string>>(fromProject);
  const [notes, setNotes] = useState(project.notes);
  const valuesKey = plan.dimensions.map(d => `${d.id}=${project.values[d.id] ?? ''}`).join('|');
  useEffect(() => { setDraft(fromProject()); setNotes(project.notes); }, [project.id, valuesKey]);
  const [custom, setCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (g: Group) => open[g.key] ?? g.dims[0]!.priority === 'required';

  const commit = () => {
    const values: Record<string, number> = {};
    for (const [id, raw] of Object.entries(draft)) {
      const v = Number(raw);
      if (raw !== '' && !Number.isNaN(v) && v >= 0) values[id] = v;
    }
    const same = JSON.stringify(values) === JSON.stringify(project.values) && notes === project.notes;
    if (!same) onChange({ values, extra: project.extra, notes });
  };
  const entered = (d: RequestedDimension) => project.values[d.id] != null;
  const setSkip = (ids: string[], skip: boolean) => {
    const next = new Set(project.skipped);
    for (const id of ids) skip ? next.add(id) : next.delete(id);
    onSkipped([...next]);
  };
  const isActiveGroup = (g: Group) => active?.label === g.label && active.ids.length === g.dims.length;

  return (
    <div className="dimension-form flex flex-col gap-5">
      {tiers.map(tier => {
        const groups = groupsOf(plan.dimensions, tier.priority);
        if (groups.length === 0) return null;
        const all = groups.flatMap(g => g.dims);
        const live = all.filter(d => !skipped.has(d.id));
        const done = live.filter(entered).length;
        return (
          <section key={tier.priority} className={`dimension-tier tier-${tier.priority}`}>
            <div className="flex items-baseline gap-3 border-b border-neutral-800 pb-1">
              <h2 className="font-semibold">{tier.title}</h2>
              <span className="text-neutral-400">{done} of {live.length}{all.length > live.length ? `, ${all.length - live.length} skipped` : ''}</span>
              {tier.priority !== 'required' && (
                <button type="button" className="ml-auto text-xs text-neutral-500 hover:text-white" onClick={() => setSkip(all.map(d => d.id), live.length > 0)}>
                  {live.length > 0 ? 'skip all' : 'unskip all'}
                </button>
              )}
            </div>
            <p className="mb-1 text-xs text-neutral-500">{tier.note}</p>
            {groups.map(g => {
              const ids = g.dims.map(d => d.id);
              const gSkipped = ids.every(id => skipped.has(id));
              const gLive = g.dims.filter(d => !skipped.has(d.id));
              const target: Target = { ids, label: g.label };
              return (
                <div key={g.key} className={`dimension-group ${isActiveGroup(g) ? 'is-active' : ''}`}>
                  <div className="dimension-group-header" onMouseEnter={() => onHover(target)} onMouseLeave={() => onHover(null)}
                    >
                    <button type="button" className="group-toggle" aria-expanded={isOpen(g)} onClick={() => { setOpen({ ...open, [g.key]: !isOpen(g) }); onFocus(target); }}>
                    <span className={gSkipped ? 'text-neutral-500 line-through' : ''}>{g.label}</span>
                    <span className="text-xs text-neutral-400">{gSkipped ? 'skipped' : `${gLive.filter(entered).length}/${gLive.length}`}</span>
                    </button>
                    <button type="button" className="ml-auto text-xs text-neutral-500 hover:text-white" onClick={e => { e.stopPropagation(); setSkip(ids, !gSkipped); }}>
                      {gSkipped ? 'unskip' : 'skip'}
                    </button>
                  </div>
                  {isOpen(g) && g.dims.map(d => {
                    const s = skipped.has(d.id);
                    const isActive = active?.ids.length === 1 && active.ids[0] === d.id;
                    const one: Target = { ids: [d.id], label: d.name };
                    return (
                      <div key={d.id} className={`dimension-reading ml-5 px-1 py-0.5 ${isActive ? 'bg-neutral-900' : ''} ${s ? 'opacity-50' : ''}`} onMouseEnter={() => onHover(one)} onMouseLeave={() => onHover(null)}>
                        <label className="grid grid-cols-[1fr_6rem] items-center gap-2">
                          <span>
                            <span className={s ? 'line-through' : ''}>{d.name}</span>
                            <span className="block text-xs text-neutral-400">{d.why}</span>
                          </span>
                          <span className="measurement-input"><input id={`dim-${d.id}`} type="number" min="0" step="0.01" inputMode="decimal" aria-label={d.name} disabled={s}
                            placeholder={d.priority === 'required' && d.default_mm != null ? `~${d.default_mm}, measure it` : 'mm'}
                            value={draft[d.id] ?? ''} onFocus={e => { onFocus(one); e.target.select(); }} onBlur={commit}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            onChange={e => setDraft({ ...draft, [d.id]: e.target.value })}
                            className="bg-neutral-900 px-2 py-1 text-right disabled:opacity-40" /><span>mm</span></span>
                        </label>
                        <div className="flex gap-3 text-xs">
                          <button type="button" onClick={() => setSkip([d.id], !s)} className="text-neutral-500 hover:text-white">{s ? 'Unskip' : "Doesn't apply, skip"}</button>
                          {!s && <Clarify dimension={d} thread={project.clarifications[d.id] ?? []} onAsk={q => onAsk(d.id, q)} onOpen={() => onFocus(one)} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>
        );
      })}
      <button type="button" className="add-measurement" aria-expanded={custom} onClick={() => setCustom(v => !v)}>＋ Add a measurement</button>
      {custom && <div className="custom-measurement"><label>Measurement name<input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="e.g. Cable opening" /></label><label>Value (mm)<input type="number" min="0.01" step="0.01" value={customValue} onChange={e => setCustomValue(e.target.value)} /></label><button type="button" disabled={!customName.trim() || !Number.isFinite(Number(customValue)) || Number(customValue) <= 0} onClick={() => { onChange({ values: project.values, extra: [...project.extra, { id: `user_${Date.now()}`, name: customName.trim(), kind: 'other', hole: null, value_mm: Number(customValue), estimated: false }], notes }); setCustom(false); setCustomName(''); setCustomValue(''); }}>Add measurement</button></div>}
      {project.extra.map(x => <div key={x.id} className="px-1 text-neutral-400">{x.name}: {x.value_mm} mm</div>)}
      <label className="notes-label">Refinement notes<textarea value={notes} placeholder="Notes for the next generation, e.g. holes were 0.5 mm too far apart"
        onChange={e => setNotes(e.target.value)} onBlur={commit}
        className="min-h-20 bg-neutral-900 p-2" /></label>
    </div>
  );
}

/** Q&A thread under one dimension. "Unclear?" opens a one-line question box; answers stay under the field. */
function Clarify({ dimension, thread, onAsk, onOpen }: { dimension: RequestedDimension; thread: { question: string; answer: string }[]; onAsk: (q: string) => Promise<unknown>; onOpen: () => void }) {
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
    <div className="flex-1">
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
        <button type="button" onClick={() => { setOpen(true); onOpen(); }} className="text-neutral-500 hover:text-white">Unclear? Ask about this measurement</button>
      )}
      {error && <div className="text-red-400">{error}</div>}
    </div>
  );
}
