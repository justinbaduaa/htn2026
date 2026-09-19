import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectSchema, type Project } from '../src/shared/types';

export const ROOT = join(process.cwd(), 'projects');
export const dir = (id: string) => join(ROOT, id);
export const runDir = (id: string, n: number) => join(dir(id), 'runs', String(n));

export async function list(): Promise<Project[]> {
  await mkdir(ROOT, { recursive: true });
  const ids = (await readdir(ROOT, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name);
  const projects = await Promise.all(ids.map(id => load(id).catch(() => null)));
  return projects.filter((p): p is Project => p !== null).sort((a, b) => b.created.localeCompare(a.created));
}

export async function load(id: string): Promise<Project> {
  return projectSchema.parse(JSON.parse(await readFile(join(dir(id), 'project.json'), 'utf8')));
}

export async function save(project: Project) {
  await mkdir(dir(project.id), { recursive: true });
  await writeFile(join(dir(project.id), 'project.json'), JSON.stringify(project, null, 2));
}

export async function create(photos: { data: Uint8Array }[]): Promise<Project> {
  const id = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  await mkdir(join(dir(id), 'photos'), { recursive: true });
  const names: string[] = [];
  for (const [i, p] of photos.entries()) {
    const name = `${i}.jpg`;
    await writeFile(join(dir(id), 'photos', name), p.data);
    names.push(name);
  }
  const project: Project = { id, title: 'Untitled', created: new Date().toISOString(), photos: names, plan: null, values: {}, extra: [], notes: '', runs: [] };
  await save(project);
  return project;
}
