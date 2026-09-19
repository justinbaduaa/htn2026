import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import { model } from './model';
import { planPrompt } from './prompts';
import * as store from './store';
import * as generate from './generate';
import { enteredDimensionSchema, requestedDimensionSchema } from '../src/shared/types';
import { join } from 'node:path';

export const app = new Hono();
app.get('/api/health', c => c.json({ ok: true, busy: generate.isBusy() }));
app.get('/api/projects', async c => c.json(await store.list()));
app.get('/api/projects/:id', async c => c.json(await store.load(c.req.param('id'))));

app.post('/api/projects', async c => {
  const form = await c.req.formData();
  const files = form.getAll('photos').filter((f): f is File => f instanceof File).slice(0, 4);
  if (files.length === 0) return c.json({ error: 'Add at least one photo.' }, 400);
  const photos = await Promise.all(files.map(async f => ({ data: new Uint8Array(await f.arrayBuffer()) })));
  return c.json(await store.create(photos));
});

app.post('/api/projects/:id/plan', async c => {
  const project = await store.load(c.req.param('id'));
  const paths = project.photos.map(p => join(store.dir(project.id), 'photos', p));
  try {
    const plan = await model.plan(paths, planPrompt);
    project.plan = plan; project.title = plan.title;
    await store.save(project);
    return c.json(project);
  } catch (error) {
    console.error('plan failed', error);
    return c.json({ error: 'The model could not read the photos. Check codex login and try again.' }, 502);
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

app.post('/api/projects/:id/generate', async c => {
  if (generate.isBusy()) return c.json({ error: 'A generation is already running.' }, 409);
  try { return c.json(await generate.start(c.req.param('id'))); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Could not start.' }, 400); }
});

app.use('/api/files/*', serveStatic({ root: './projects', rewriteRequestPath: p => p.replace(/^\/api\/files/, '') }));

serve({ fetch: app.fetch, port: 8787 }, () => console.log('server on 8787'));
