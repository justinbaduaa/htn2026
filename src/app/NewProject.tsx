import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../shared/api';
import { useElapsed } from './useElapsed';

/** Home screen. Photos plus a description, then straight into the plan call so the project page opens with measurements requested. */
export function NewProject() {
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState('');
  const [startedAt, setStartedAt] = useState<number>();
  const start = useMutation({
    mutationFn: async () => {
      setStartedAt(Date.now());
      const project = await api.create(files, description);
      await api.plan(project.id);
      return project;
    },
    onSuccess: p => { location.hash = `#p/${p.id}`; },
  });
  const elapsed = useElapsed(start.isPending, startedAt);
  return (
    <form onSubmit={e => { e.preventDefault(); start.mutate(); }} className="mx-auto flex max-w-xl flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span>Photos of the object. One to four, the first one straight on.</span>
        <input type="file" accept="image/*" multiple onChange={e => setFiles([...(e.target.files ?? [])].slice(0, 4))} />
        {files.length > 0 && (
          <div className="flex gap-2">{files.map(f => <img key={f.name} src={URL.createObjectURL(f)} className="h-20" alt="" />)}</div>
        )}
      </label>
      <label className="flex flex-col gap-2">
        <span>What is it, and what do you want printed? Mention screws, ports, and how it should mount.</span>
        <textarea value={description} onChange={e => setDescription(e.target.value)} className="min-h-32 bg-neutral-900 p-2"
          placeholder="Hack the North badge, a PCB the size of a Game Boy. I want a case that screws on using the four M4 holes, with the screen and buttons open." />
      </label>
      <button disabled={files.length === 0 || start.isPending} className="w-fit bg-white px-3 py-1 text-black disabled:opacity-40">
        {start.isPending ? `Looking at the photos, ${elapsed} s` : 'Identify part and measurements'}
      </button>
      {start.isPending && <p className="text-neutral-400">Usually 30 to 90 seconds. A failure shows here in red.</p>}
      {start.error && <p className="text-red-400">Failed: {start.error.message}</p>}
    </form>
  );
}
