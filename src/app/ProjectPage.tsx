import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../shared/api';
import { PhotoCallouts } from './PhotoCallouts';
import { DimensionForm, missingCritical } from './DimensionForm';
import { RunPanel } from './RunPanel';

export function ProjectPage({ id }: { id: string }) {
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const { data: project } = useQuery({
    queryKey: ['project', id], queryFn: () => api.get(id),
    refetchInterval: q => q.state.data?.runs.some(r => r.status === 'running') ? 2000 : false,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['project', id] });
  const plan = useMutation({ mutationFn: () => api.plan(id), onSuccess: invalidate });
  const save = useMutation({ mutationFn: (body: Parameters<typeof api.saveDimensions>[1]) => api.saveDimensions(id, body), onSuccess: invalidate });
  const generate = useMutation({ mutationFn: () => api.generate(id), onSuccess: invalidate });
  const accept = useMutation({ mutationFn: (n: number) => api.acceptNeeds(id, n), onSuccess: invalidate });
  const skip = useMutation({ mutationFn: (dimensionId: string) => api.skip(id, dimensionId), onSuccess: invalidate });
  const ask = useMutation({ mutationFn: (v: { dimensionId: string; question: string }) => api.ask(id, v.dimensionId, v.question), onSuccess: invalidate });
  if (!project) return null;

  const missing = missingCritical(project);
  const running = project.runs.some(r => r.status === 'running');
  const activeDim = project.plan?.dimensions.find(d => d.id === active);
  const photoIndex = activeDim?.photo ?? 0;

  return (
    <div className="grid gap-6 md:grid-cols-[3fr_2fr]">
      <div className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">{project.title}</h1>
        {project.description && <p className="text-neutral-400">{project.description}</p>}
        {project.plan && <p>{project.plan.summary}</p>}
        <PhotoCallouts src={api.fileUrl(id, 'photos', project.photos[photoIndex]!)} dimension={activeDim ?? null} />
        <div className="flex gap-2">
          {project.photos.map((p, i) => <img key={p} src={api.fileUrl(id, 'photos', p)} onClick={() => setActive(project.plan?.dimensions.find(d => d.photo === i)?.id ?? null)}
            className={`h-16 cursor-pointer ${i === photoIndex ? 'opacity-100' : 'opacity-50'}`} alt="" />)}
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
            <DimensionForm project={project} active={active} onFocus={setActive} onChange={body => save.mutate(body)}
              onAsk={(dimensionId, question) => ask.mutateAsync({ dimensionId, question })} onSkip={dimensionId => skip.mutate(dimensionId)} />
            <button onClick={() => generate.mutate()} disabled={missing.length > 0 || running || generate.isPending}
              className="w-fit bg-white px-3 py-1 text-black disabled:opacity-40">
              {running ? 'Generating' : project.runs.length ? 'Generate again' : 'Generate'}
            </button>
            {missing.length > 0 && <p className="text-neutral-400">Measure {missing.map(d => d.name).join(', ')} first.</p>}
            {generate.error && <p className="text-red-400">{generate.error.message}</p>}
          </>
        )}
        {[...project.runs].reverse().map(run => <RunPanel key={run.n} project={project} run={run} onAcceptNeeds={() => accept.mutate(run.n)} />)}
      </div>
    </div>
  );
}
