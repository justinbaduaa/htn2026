import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import { model } from './model';
import { askPrompt, planPrompt } from './prompts';
import * as store from './store';
import * as generate from './generate';
import { enteredDimensionSchema, requestedDimensionSchema } from '../src/shared/types';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

mkdirSync(store.ROOT, { recursive: true });
void generate.recoverOrphans();

export const app = new Hono();
app.get('/api/health', c => c.json({ ok: true, busy: generate.isBusy() }));
app.get('/api/projects', async c => c.json(await store.list()));
app.get('/api/projects/:id', async c => c.json(await store.load(c.req.param('id'))));
app.delete('/api/projects/:id', async c => { await store.remove(c.req.param('id')); return c.json({ ok: true }); });
app.delete('/api/projects', async c => { if (generate.isBusy()) return c.json({ error: 'A generation is running.' }, 409); await store.removeAll(); return c.json({ ok: true }); });

app.post('/api/projects', async c => {
  const form = await c.req.formData();
  const files = form.getAll('photos').filter((f): f is File => f instanceof File).slice(0, 4);
  if (files.length === 0) return c.json({ error: 'Add at least one photo.' }, 400);
  const photos = await Promise.all(files.map(async f => ({ data: new Uint8Array(await f.arrayBuffer()) })));
  const description = String(form.get('description') ?? '').slice(0, 3000);
  return c.json(await store.create(photos, description));
});

app.post('/api/projects/:id/plan', async c => {
  const project = await store.load(c.req.param('id'));
  const paths = project.photos.map(p => join(store.dir(project.id), 'photos', p));
  try {
    const plan = await model.plan(paths, planPrompt(project.description));
    // Models sometimes number photos from 1. Keep every callout on a photo that exists.
    plan.dimensions = plan.dimensions.map(d => ({ ...d, photo: Math.min(Math.max(d.photo, 0), project.photos.length - 1) }));
    project.plan = plan; project.title = plan.title;
    await store.save(project);
    return c.json(project);
  } catch (error) {
    console.error('plan failed', error);
    return c.json({ error: `The model call failed. ${error instanceof Error ? error.message : String(error)}` }, 502);
  }
});

const valuesBody = z.strictObject({ values: z.record(z.string(), z.number()), extra: z.array(enteredDimensionSchema), notes: z.string() });
app.put('/api/projects/:id/dimensions', async c => {
  const body = valuesBody.parse(await c.req.json());
  const project = await store.load(c.req.param('id'));
  Object.assign(project, body);
  await store.save(project);
  return c.json(project);
});

// Adds model-requested extra dimensions (from a needs_dimensions run) to the plan as critical.
app.post('/api/projects/:id/accept-needs/:n', async c => {
  const project = await store.load(c.req.param('id'));
  const run = project.runs[Number(c.req.param('n'))];
  if (!run?.needs || !project.plan) return c.json({ error: 'No pending dimensions.' }, 400);
  const known = new Set(project.plan.dimensions.map(d => d.id));
  project.plan.dimensions.push(...run.needs.filter(d => !known.has(d.id)).map(d => requestedDimensionSchema.parse({ ...d, critical: true })));
  run.needs = null;
  await store.save(project);
  return c.json(project);
});

// A question about one requested dimension. Stores the Q&A and applies the model's clearer rewrite of the dimension if it gives one.
const askBody = z.strictObject({ dimensionId: z.string(), question: z.string().min(1).max(600) });
app.post('/api/projects/:id/ask', async c => {
  const body = askBody.parse(await c.req.json());
  const project = await store.load(c.req.param('id'));
  const index = project.plan?.dimensions.findIndex(d => d.id === body.dimensionId) ?? -1;
  const dimension = project.plan?.dimensions[index];
  if (!project.plan || !dimension) return c.json({ error: 'Unknown dimension.' }, 400);
  const paths = project.photos.map(p => join(store.dir(project.id), 'photos', p));
  const prior = project.clarifications[dimension.id] ?? [];
  try {
    const result = await model.ask(paths, askPrompt(project.description, project.plan, dimension, prior, body.question));
    project.clarifications[dimension.id] = [...prior, { question: body.question, answer: result.answer }];
    if (result.revised && result.revised.id === dimension.id) {
      project.plan.dimensions[index] = { ...result.revised, kind: dimension.kind, hole: dimension.hole, critical: dimension.critical,
        photo: Math.min(Math.max(result.revised.photo, 0), project.photos.length - 1) };
    }
    await store.save(project);
    return c.json(project);
  } catch (error) {
    console.error('ask failed', error);
    return c.json({ error: 'The model could not answer. Try again.' }, 502);
  }
});

// The user says a requested measurement does not apply. It stops blocking Generate; the model is told it was skipped.
app.post('/api/projects/:id/skip/:dim', async c => {
  const project = await store.load(c.req.param('id'));
  const d = project.plan?.dimensions.find(x => x.id === c.req.param('dim'));
  if (!d) return c.json({ error: 'Unknown dimension.' }, 400);
  d.critical = false;
  d.why = `${d.why} (User skipped this: it does not apply to their object.)`.slice(0, 400);
  await store.save(project);
  return c.json(project);
});

app.post('/api/projects/:id/generate', async c => {
  if (generate.isBusy()) return c.json({ error: 'A generation is already running.' }, 409);
  try { return c.json(await generate.start(c.req.param('id'))); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not start.' }, 400); }
});

app.use('/api/files/*', serveStatic({ root: './projects', rewriteRequestPath: p => p.replace(/^\/api\/files/, '') }));

serve({ fetch: app.fetch, port: 8787 }, () => console.log('server on 8787'));
