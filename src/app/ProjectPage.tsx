import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../shared/api';
import { PhotoCallouts } from './PhotoCallouts';
import { DimensionForm, missingRequired, type Target } from './DimensionForm';
import { RunPanel } from './RunPanel';

export function ProjectPage({ id }: { id: string }) {
  const qc = useQueryClient();
  const [active, setActive] = useState<Target | null>(null);
  const [hovered, setHovered] = useState<Target | null>(null);
  const [photoOverride, setPhotoOverride] = useState<number | null>(null);
  const { data: project } = useQuery({
    queryKey: ['project', id], queryFn: () => api.get(id),
    refetchInterval: q => q.state.data?.runs.some(r => r.status === 'running') ? 2000 : false,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['project', id] });
  const plan = useMutation({ mutationFn: () => api.plan(id), onSuccess: invalidate });
  const save = useMutation({ mutationFn: (body: Parameters<typeof api.saveDimensions>[1]) => api.saveDimensions(id, body), onSuccess: invalidate });
  const generate = useMutation({ mutationFn: () => api.generate(id), onSuccess: invalidate });
  const accept = useMutation({ mutationFn: (n: number) => api.acceptNeeds(id, n), onSuccess: invalidate });
  const skipped = useMutation({ mutationFn: (ids: string[]) => api.setSkipped(id, ids), onSuccess: invalidate });
  const ask = useMutation({ mutationFn: (v: { dimensionId: string; question: string }) => api.ask(id, v.dimensionId, v.question), onSuccess: invalidate });
  if (!project) return null;

  const dims = project.plan?.dimensions ?? [];
  const missing = missingRequired(project);
  const running = project.runs.some(r => r.status === 'running');
  const lit = hovered ?? active;
  // The photo follows whatever is lit: the hovered reading or group, else the focused one. Otherwise a
  // reading whose callout sits on another photo than its group lights nothing when hovered.
  const bestPhoto = (t: Target | null) => {
    if (!t) return null;
    const counts = new Map<number, number>();
    for (const d of dims) if (t.ids.includes(d.id) && d.shape !== 'none') counts.set(d.photo, (counts.get(d.photo) ?? 0) + 1);
    let best: number | null = null;
    for (const [p, n] of counts) if (best === null || n > counts.get(best)!) best = p;
    return best;
  };
  const photoIndex = bestPhoto(lit) ?? bestPhoto(active) ?? photoOverride ?? 0;
  const single = (dimId: string): Target => ({ ids: [dimId], label: dims.find(d => d.id === dimId)?.name ?? dimId });
  const pick = (dimId: string) => { setActive(single(dimId)); document.getElementById(`dim-${dimId}`)?.focus(); };
  const onPhoto = (i: number) => dims.filter(d => d.photo === i).length;
  const missingGroups = [...new Set(missing.map(d => d.group ?? d.name))];

  return (
    <div className="grid gap-6 md:grid-cols-[3fr_2fr]">
      <div className="flex flex-col gap-3 md:sticky md:top-4 md:self-start">
        <h1 className="text-lg font-semibold">{project.title}</h1>
        {project.description && <p className="text-neutral-400">{project.description}</p>}
        {project.plan && <p>{project.plan.summary}</p>}
        <PhotoCallouts src={api.fileUrl(id, 'photos', project.photos[photoIndex]!)} lit={lit?.ids ?? []} label={lit?.label ?? null}
          onHover={dimId => setHovered(dimId ? single(dimId) : null)} onPick={pick}
          dimensions={dims.filter(d => d.photo === photoIndex)} />
        <div className="flex gap-2">
          {project.photos.map((p, i) => (
            <button key={p} type="button" onClick={() => { setActive(null); setPhotoOverride(i); }} className="relative">
              <img src={api.fileUrl(id, 'photos', p)} className={`h-16 ${i === photoIndex ? 'opacity-100' : 'opacity-50'}`} alt="" />
              {onPhoto(i) > 0 && <span className="absolute right-0 top-0 bg-black/80 px-1 text-xs">{onPhoto(i)}</span>}
            </button>
          ))}
        </div>
        <button onClick={() => plan.mutate()} disabled={plan.isPending || running}
          className={`w-fit px-3 py-1 disabled:opacity-40 ${project.plan ? 'text-neutral-400 hover:text-white' : 'bg-white text-black'}`}>
          {plan.isPending ? 'Looking at the photos' : project.plan ? 'Identify again (redoes the measurement list)' : 'Identify part and measurements'}
        </button>
        {plan.error && <p className="text-red-400">{plan.error.message}</p>}
        {project.plan?.question && <p className="text-yellow-300">{project.plan.question}</p>}
      </div>
      <div className="flex flex-col gap-4">
        {project.plan && (
          <>
            <DimensionForm project={project} active={active} onFocus={setActive} onHover={setHovered} onChange={body => save.mutate(body)}
              onAsk={(dimensionId, question) => ask.mutateAsync({ dimensionId, question })} onSkipped={ids => skipped.mutate(ids)} />
            <button onClick={() => generate.mutate()} disabled={missing.length > 0 || running || generate.isPending}
              className="w-fit bg-white px-3 py-1 text-black disabled:opacity-40">
              {running ? 'Generating' : project.runs.length ? 'Generate again' : 'Generate'}
            </button>
            {missing.length > 0 && (
              <p className="text-neutral-400">{missing.length} required reading{missing.length > 1 ? 's' : ''} left: {missingGroups.join(', ')}. Measure or skip them to unlock Generate.</p>
            )}
            {generate.error && <p className="text-red-400">{generate.error.message}</p>}
          </>
        )}
        {[...project.runs].reverse().map(run => <RunPanel key={run.n} project={project} run={run} onAcceptNeeds={() => accept.mutate(run.n)} />)}
      </div>
    </div>
  );
}
