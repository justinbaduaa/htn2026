import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { checkResultSchema, dimsFileSchema, needsFileSchema, type DimsFile, type Project, type Run } from '../src/shared/types';
import { model } from './model';
import { constants, generatePrompt } from './prompts';
import { slice } from './slice';
import * as store from './store';

let active: string | null = null;
export const isBusy = () => active !== null;

/** Turns the project's plan and entered values into the dims.json the model and checker read. Throws if a critical value is missing. */
function buildDims(project: Project): DimsFile {
  if (!project.plan) throw new Error('No plan yet');
  const requested = project.plan.dimensions.flatMap(d => {
    const value = project.values[d.id] ?? d.default_mm;
    if (value == null) { if (d.critical) throw new Error(`Missing critical dimension: ${d.name}`); return []; }
    return [{ id: d.id, name: d.name, kind: d.kind, hole: d.hole, value_mm: value }];
  });
  return dimsFileSchema.parse({ title: project.title, plan: project.plan, dimensions: [...requested, ...project.extra], constants, notes: project.notes });
}

/** Starts a run and returns immediately. Progress is written to project.json. */
export async function start(id: string): Promise<Run> {
  if (active) throw new Error('busy');
  const project = await store.load(id);
  const dims = buildDims(project);
  const n = project.runs.length;
  const dirPath = store.runDir(id, n);
  await mkdir(dirPath, { recursive: true });
  await writeFile(join(dirPath, 'dims.json'), JSON.stringify(dims, null, 2));
  await writeFile(join(dirPath, 'check.py'), await readFile(join(process.cwd(), 'cad', 'check.py')));
  const previousRun = [...project.runs].reverse().find(r => r.status === 'done');
  const previous = previousRun ? await readFile(join(store.runDir(id, previousRun.n), 'part.py'), 'utf8').catch(() => null) : null;
  const run: Run = { n, started: new Date().toISOString(), status: 'running', error: null, check: null, needs: null, files: [] };
  project.runs.push(run);
  await store.save(project);
  active = id;
  void execute(id, n, dirPath, dims, previous).finally(() => { active = null; });
  return run;
}

async function execute(id: string, n: number, dirPath: string, dims: DimsFile, previous: string | null) {
  const update = async (patch: Partial<Run>) => {
    const project = await store.load(id);
    project.runs[n] = { ...project.runs[n]!, ...patch };
    await store.save(project);
  };
  try {
    await model.generate(dirPath, generatePrompt(dims, previous), new AbortController().signal);
    const files = await readdir(dirPath);
    if (files.includes('needs.json')) {
      const needs = needsFileSchema.parse(JSON.parse(await readFile(join(dirPath, 'needs.json'), 'utf8')));
      await update({ status: 'needs_dimensions', needs: needs.dimensions });
      return;
    }
    if (!files.includes('check.json')) { await update({ status: 'failed', error: 'The model finished without running the checker.' }); return; }
    const check = checkResultSchema.parse(JSON.parse(await readFile(join(dirPath, 'check.json'), 'utf8')));
    if (!check.ok) { await update({ status: 'failed', check, error: check.error ?? 'Checker rejected the part.' }); return; }
    const outputs: Run['files'] = [];
    for (const part of check.parts) {
      const stl = join(dirPath, `${part.name}.stl`);
      const sliced = await slice(stl);
      outputs.push({ part: part.name, step: `${part.name}.step`, stl: basename(stl), gcode: sliced ? basename(sliced.gcode) : null, minutes: sliced?.minutes ?? null });
    }
    await update({ status: 'done', check, files: outputs });
  } catch (error) {
    await update({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}
