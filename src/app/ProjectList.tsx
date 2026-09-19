import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api';

export function ProjectList() {
  const { data } = useQuery({ queryKey: ['projects'], queryFn: api.list });
  if (!data) return null;
  if (data.length === 0) return <p>No projects. <a className="underline" href="#new">Start one</a>.</p>;
  return (
    <table className="w-full">
      <tbody>{data.map(p => (
        <tr key={p.id} className="border-t border-neutral-800">
          <td className="py-2"><a href={`#p/${p.id}`} className="hover:underline">{p.title}</a></td>
          <td className="text-neutral-400">{p.runs.length} runs</td>
          <td className="text-neutral-400">{p.runs.at(-1)?.status ?? 'no runs'}</td>
        </tr>))}
      </tbody>
    </table>
  );
}
