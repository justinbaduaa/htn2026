import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../shared/api';

export function ProjectList() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['projects'], queryFn: api.list });
  const refresh = () => qc.invalidateQueries({ queryKey: ['projects'] });
  const remove = useMutation({ mutationFn: api.remove, onSuccess: refresh });
  const removeAll = useMutation({ mutationFn: api.removeAll, onSuccess: refresh });
  if (!data) return null;
  if (data.length === 0) return <p>No projects. <a className="underline" href="#">Start one</a>.</p>;
  return (
    <div className="flex flex-col gap-4">
      <table className="w-full">
        <tbody>{data.map(p => (
          <tr key={p.id} className="border-t border-neutral-800">
            <td className="py-2"><a href={`#p/${p.id}`} className="hover:underline">{p.title}</a></td>
            <td className="text-neutral-400">{p.runs.length} runs</td>
            <td className="text-neutral-400">{p.runs.at(-1)?.status ?? 'no runs'}</td>
            <td className="text-right"><button onClick={() => remove.mutate(p.id)} className="text-neutral-500 hover:text-white">delete</button></td>
          </tr>))}
        </tbody>
      </table>
      <button onClick={() => { if (confirm('Delete every project, photo, and run?')) removeAll.mutate(); }} className="w-fit text-neutral-500 hover:text-red-400">
        Reset everything
      </button>
      {removeAll.error && <p className="text-red-400">{removeAll.error.message}</p>}
    </div>
  );
}
