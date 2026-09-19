import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { checkResultSchema, dimsFileSchema, needsFileSchema, type DimsFile, type Project, type Run } from '../src/shared/types';
import { model } from './model';
import { constants, generatePrompt } from './prompts';
import { slice } from './slice';
import * as store from './store';

let active: string | null = null;
export const isBusy = () => active !== null;

/**
 * Turns the project's plan and entered values into the dims.json the model and checker read.
 * Skipped readings are left out entirely. A blank non-required reading falls back to the plan's
 * default_mm, flagged as estimated. Throws if a required reading is neither entered nor skipped.
 */
export function buildDims(project: Project): DimsFile {
  if (!project.plan) throw new Error('No plan yet');
  const skipped = new Set(project.skipped);
  const requested = project.plan.dimensions.flatMap(d => {
    if (skipped.has(d.id)) return [];
    const entered = project.values[d.id];
    if (entered != null) return [{ id: d.id, name: d.name, kind: d.kind, hole: d.hole, value_mm: entered, estimated: false }];
    if (d.priority === 'required') throw new Error(`Missing required dimension: ${d.name}`);
    if (d.default_mm == null) return [];
    return [{ id: d.id, name: d.name, kind: d.kind, hole: d.hole, value_mm: d.default_mm, estimated: true }];
  });
  return dimsFileSchema.parse({ title: project.title, plan: project.plan, description: project.description, dimensions: [...requested, ...project.extra], constants, notes: project.notes, skipped: project.skipped });
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
  try {
    const project = await store.load(id);
    const photos = project.photos.map(p => join(store.dir(id), 'photos', p));
    await model.generate(dirPath, generatePrompt(dims, previous), new AbortController().signal, photos);
    await finalize(id, n, dirPath, 'The model finished without running the checker.');
  } catch (error) {
    await patch(id, n, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}

async function patch(id: string, n: number, changes: Partial<Run>) {
  const project = await store.load(id);
  project.runs[n] = { ...project.runs[n]!, ...changes };
  await store.save(project);
}

/** Reads what the model left in the run folder and sets the run's final status. */
async function finalize(id: string, n: number, dirPath: string, missingError: string) {
  const files = await readdir(dirPath);
  if (files.includes('needs.json')) {
    const parsed = needsFileSchema.safeParse(JSON.parse(await readFile(join(dirPath, 'needs.json'), 'utf8')));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      await patch(id, n, { status: 'failed', error: `The model asked for more measurements but wrote them in a shape the app could not read (${first?.path.join('.')}: ${first?.message}). Generate again.` });
      return;
    }
    await patch(id, n, { status: 'needs_dimensions', needs: parsed.data.dimensions });
    return;
  }
  if (!files.includes('check.json')) { await patch(id, n, { status: 'failed', error: missingError }); return; }
  const check = checkResultSchema.parse(JSON.parse(await readFile(join(dirPath, 'check.json'), 'utf8')));
  if (!check.ok) { await patch(id, n, { status: 'failed', check, error: check.error ?? 'Checker rejected the part.' }); return; }
  const outputs: Run['files'] = [];
  for (const part of check.parts) {
    const stl = join(dirPath, `${part.name}.stl`);
    const sliced = await slice(stl);
    outputs.push({ part: part.name, step: `${part.name}.step`, stl: basename(stl), gcode: sliced ? basename(sliced.gcode) : null, minutes: sliced?.minutes ?? null });
  }
  await patch(id, n, { status: 'done', check, files: outputs });
}

/** Called once at server start. A restart mid-run leaves runs marked running with nobody watching them. */
export async function recoverOrphans() {
  for (const project of await store.list()) {
    for (const run of project.runs) {
      if (run.status !== 'running') continue;
      console.log(`recovering run ${run.n} of ${project.id}`);
      await finalize(project.id, run.n, store.runDir(project.id, run.n), 'The server restarted during this run. Generate again.').catch(async error => {
        await patch(project.id, run.n, { status: 'failed', error: `Server restarted during this run (${error instanceof Error ? error.message : String(error)}). Generate again.` });
      });
    }
  }
}
