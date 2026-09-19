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

export function DimensionForm({ project, active, onFocus, onChange }: Props) {
  const plan = project.plan!;
  const set = (id: string, raw: string) => {
    const values = { ...project.values };
    const v = Number(raw);
    if (raw === '' || Number.isNaN(v)) delete values[id]; else values[id] = v;
    onChange({ values, extra: project.extra, notes: project.notes });
  };
  return (
    <div className="flex flex-col gap-2">
      {plan.dimensions.map(d => (
        <label key={d.id} className={`grid grid-cols-[1fr_6rem] items-center gap-2 px-1 ${active === d.id ? 'bg-neutral-900' : ''}`}>
          <span>
            {d.name}{d.critical && <span className="ml-1 text-neutral-400">required</span>}
            <span className="block text-xs text-neutral-400">{d.why}</span>
          </span>
          <input id={`dim-${d.id}`} type="number" step="0.01" inputMode="decimal" aria-label={d.name} onFocus={() => onFocus(d.id)}
            value={project.values[d.id] ?? (d.default_mm ?? '')} placeholder="mm" onChange={e => set(d.id, e.target.value)}
            className="bg-neutral-900 px-2 py-1 text-right" />
        </label>
      ))}
      <button type="button" className="w-fit text-neutral-400 hover:text-white" onClick={() => {
        const name = prompt('Dimension name');
        const value = Number(prompt('Value in mm'));
        if (name && value > 0) onChange({ values: project.values, extra: [...project.extra, { id: `user_${project.extra.length}`, name, kind: 'other', hole: null, value_mm: value }], notes: project.notes });
      }}>+ add a measurement the model did not ask for</button>
      {project.extra.map(x => <div key={x.id} className="px-1 text-neutral-400">{x.name}: {x.value_mm} mm</div>)}
      <textarea value={project.notes} placeholder="Notes for the next generation, e.g. holes were 0.5 mm too far apart"
        onChange={e => onChange({ values: project.values, extra: project.extra, notes: e.target.value })}
        className="mt-2 min-h-20 bg-neutral-900 p-2" />
    </div>
  );
}
