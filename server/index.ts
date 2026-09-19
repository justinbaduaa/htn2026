import { Hono } from 'hono';
import { serve } from '@hono/node-server';

export const app = new Hono();
app.get('/api/health', c => c.json({ ok: true }));

serve({ fetch: app.fetch, port: 8787 }, () => console.log('server on 8787'));
