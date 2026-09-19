import { useEffect, useState } from 'react';
import type { Project, RequestedDimension } from '../shared/types';

type Props = {
  project: Project;
  active: string | null;
  onFocus: (id: string) => void;
  onChange: (patch: Pick<Project, 'values' | 'extra' | 'notes'>) => void;
};

export function missingCritical(project: Project): RequestedDimension[] {
  return project.plan?.dimensions.filter(d => d.critical && project.values[d.id] == null) ?? [];
}

/**
 * Inputs are drafts in local state and save on blur or Enter. Saving on every keystroke
 * let the server refetch overwrite the field mid-typing and drop digits.
 */
export function DimensionForm({ project, active, onFocus, onChange }: Props) {
  const plan = project.plan!;
  const fromProject = () => Object.fromEntries(plan.dimensions.map(d => [d.id, project.values[d.id]?.toString() ?? d.default_mm?.toString() ?? '']));
  const [draft, setDraft] = useState<Record<string, string>>(fromProject);
  const [notes, setNotes] = useState(project.notes);
  useEffect(() => { setDraft(fromProject()); setNotes(project.notes); }, [project.id, plan.dimensions.length]);

  const commit = () => {
    const values: Record<string, number> = {};
    for (const [id, raw] of Object.entries(draft)) {
      const v = Number(raw);
      if (raw !== '' && !Number.isNaN(v) && v > 0) values[id] = v;
    }
    const same = JSON.stringify(values) === JSON.stringify(project.values) && notes === project.notes;
    if (!same) onChange({ values, extra: project.extra, notes });
  };

  return (
    <div className="flex flex-col gap-2">
      {plan.dimensions.map(d => (
        <label key={d.id} className={`grid grid-cols-[1fr_6rem] items-center gap-2 px-1 ${active === d.id ? 'bg-neutral-900' : ''}`}>
          <span>
            {d.name}{d.critical && <span className="ml-1 text-neutral-400">required</span>}
            <span className="block text-xs text-neutral-400">{d.why}</span>
          </span>
          <input id={`dim-${d.id}`} type="number" step="0.01" inputMode="decimal" aria-label={d.name} placeholder="mm"
            value={draft[d.id] ?? ''} onFocus={() => onFocus(d.id)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            onChange={e => setDraft({ ...draft, [d.id]: e.target.value })}
            className="bg-neutral-900 px-2 py-1 text-right" />
        </label>
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
