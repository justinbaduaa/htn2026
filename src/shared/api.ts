import { cadGeometrySchema } from './cadGeometry';
import { dimsFileSchema, projectSchema, runSchema, type DimsFile, type Project, type Run } from './types';

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}

export const api = {
  geometry: (id: string, n: number) => json<unknown>(`/api/projects/${id}/runs/${n}/geometry`).then(data => cadGeometrySchema.parse(data)),
  list: () => json<Project[]>('/api/projects').then(p => p.map(x => projectSchema.parse(x))),
  get: (id: string) => json<Project>(`/api/projects/${id}`).then(p => projectSchema.parse(p)),
  create: (photos: File[], description: string) => { const f = new FormData(); photos.forEach(p => f.append('photos', p)); f.append('description', description); return json<Project>('/api/projects', { method: 'POST', body: f }); },
  plan: (id: string) => json<Project>(`/api/projects/${id}/plan`, { method: 'POST' }),
  saveDimensions: (id: string, body: Pick<Project, 'values' | 'extra' | 'notes'>) =>
    json<Project>(`/api/projects/${id}/dimensions`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  ask: (id: string, dimensionId: string, question: string) =>
    json<Project>(`/api/projects/${id}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dimensionId, question }) }),
  remove: (id: string) => json<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),
  removeAll: () => json<{ ok: true }>('/api/projects', { method: 'DELETE' }),
  setSkipped: (id: string, ids: string[]) => json<Project>(`/api/projects/${id}/skipped`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) }),
  acceptNeeds: (id: string, n: number) => json<Project>(`/api/projects/${id}/accept-needs/${n}`, { method: 'POST' }),
  generate: (id: string) => json<Run>(`/api/projects/${id}/generate`, { method: 'POST' }).then(r => runSchema.parse(r)),
  fileUrl: (id: string, ...parts: string[]) => `/api/files/${id}/${parts.join('/')}`,
  /** The dims.json a run was generated from: what the model saw, not the form's current values. */
  dims: (id: string, n: number) => json<DimsFile>(`/api/files/${id}/runs/${n}/dims.json`).then(d => dimsFileSchema.parse(d)),
};
