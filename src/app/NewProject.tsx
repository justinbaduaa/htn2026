import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../shared/api';

export function NewProject() {
  const [files, setFiles] = useState<File[]>([]);
  const create = useMutation({ mutationFn: api.create, onSuccess: p => { location.hash = `#p/${p.id}`; } });
  return (
    <form onSubmit={e => { e.preventDefault(); create.mutate(files); }} className="flex flex-col gap-4">
      <label>Photos of the object, 1 to 4, the first one straight on
        <input type="file" accept="image/*" multiple className="mt-2 block" onChange={e => setFiles([...(e.target.files ?? [])].slice(0, 4))} />
      </label>
      <button disabled={files.length === 0 || create.isPending} className="w-fit bg-white px-3 py-1 text-black disabled:opacity-40">Create project</button>
      {create.error && <p className="text-red-400">{create.error.message}</p>}
    </form>
  );
}
