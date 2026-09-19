import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../shared/api';

export function ProjectList() {
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['projects'], queryFn: api.list });
  const refresh = () => qc.invalidateQueries({ queryKey: ['projects'] });
  const remove = useMutation({ mutationFn: api.remove, onSuccess: refresh });
  const removeAll = useMutation({ mutationFn: api.removeAll, onSuccess: refresh });
  if (error) return <p className="error-message" role="alert">Could not load projects: {error.message}</p>;
  if (!data) return <p className="page-loading" role="status">Loading projects…</p>;
  return <section className="projects-page"><div className="project-heading"><h1>Projects</h1><a className="primary-button" href="#">＋ New project</a></div>
    {data.length === 0 ? <div className="empty-projects"><p>No projects yet.</p><a href="#" className="primary-button">New project</a></div> : <><div className="projects-grid">{data.map(p => <article className="project-card" key={p.id}><a href={`#p/${p.id}`}>{p.photos[0] && <img src={api.fileUrl(p.id, 'photos', p.photos[0])} alt={p.title} />}<div className="project-card-copy"><h2>{p.title}</h2><p>{p.runs.length} version{p.runs.length === 1 ? '' : 's'}</p></div></a><div className="project-card-footer"><span>{p.runs.at(-1)?.status.replaceAll('_', ' ') ?? 'Ready to measure'}</span><button disabled={remove.isPending} onClick={() => { if (confirm(`Delete “${p.title}” and its files?`)) remove.mutate(p.id); }}>Delete</button></div></article>)}</div><button disabled={removeAll.isPending} onClick={() => { if (confirm('Delete every project, photo, and run?')) removeAll.mutate(); }}>Delete all projects</button></>}
    {(remove.error || removeAll.error) && <p className="error-message" role="alert">{(remove.error || removeAll.error)!.message}</p>}
  </section>;
}
