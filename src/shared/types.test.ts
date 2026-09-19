import { expect, test } from 'vitest';
import { planSchema, dimsFileSchema, normalizePlan, datumLines } from './types';

test('plan schema rejects a dimension with no callout', () => {
  const bad = { title: 't', summary: 's', parts: [], question: '', dimensions: [{ id: 'a', name: 'n', why: 'w', critical: true, kind: 'extent_x', hole: null, photo: 0, default_mm: null }] };
  expect(planSchema.safeParse(bad).success).toBe(false);
});

test('dims file accepts entered dimensions with constants', () => {
  const dims = { title: 't', plan: { title: 't', summary: 's', parts: [], question: '', dimensions: [] },
    dimensions: [{ id: 'a', name: 'n', kind: 'hole_x', hole: 'h1', value_mm: 12.5 }],
    constants: { fit_clearance_mm: 0.3, hole_compensation_mm: 0.2, wall_mm: 2.4 } };
  expect(dimsFileSchema.safeParse(dims).success).toBe(true);
});

test('normalizePlan derives priority for plans that only had critical, then sorts by tier', () => {
  const d = (id: string, critical: boolean, priority?: string) => ({ id, name: id, why: '', critical, ...(priority ? { priority } : {}), kind: 'other', hole: null, photo: 0, box: { x: 0, y: 0, w: 0, h: 0 }, default_mm: null });
  const legacy = planSchema.parse({ title: 't', summary: 's', parts: [], question: '', dimensions: [d('a', false), d('b', true)] });
  normalizePlan(legacy);
  expect(legacy.dimensions.map(x => [x.id, x.priority, x.critical])).toEqual([['b', 'required', true], ['a', 'optional', false]]);

  const modern = planSchema.parse({ title: 't', summary: 's', parts: [], question: '', dimensions: [d('a', true, 'optional'), d('b', true, 'recommended'), d('c', false, 'required')] });
  normalizePlan(modern);
  expect(modern.dimensions.map(x => [x.id, x.priority, x.critical])).toEqual([['c', 'required', true], ['b', 'recommended', false], ['a', 'optional', false]]);
});

test('datumLines redraws a hole position that reused the diameter circle as a line from the board edge', () => {
  const circle = { x: 0.6, y: 0.1, w: 0.04, h: 0.04 };
  const dim = (id: string, kind: string, shape: string, box: object, hole: string | null = 'h1') => ({ id, name: id, why: '', critical: true, priority: 'required', kind, hole, photo: 0, shape, box, default_mm: null });
  const plan = planSchema.parse({ title: 't', summary: '', parts: [], question: '', dimensions: [
    dim('w', 'extent_x', 'line', { x: 0.1, y: 0.8, w: 0.7, h: 0 }, null),
    dim('h', 'extent_y', 'line', { x: 0.85, y: 0.05, w: 0, h: 0.85 }, null),
    dim('h1x', 'hole_x', 'circle', circle), dim('h1y', 'hole_y', 'circle', circle), dim('h1d', 'hole_diameter', 'circle', circle),
  ] });
  datumLines(plan);
  const by = Object.fromEntries(plan.dimensions.map(d => [d.id, d]));
  expect(by.h1x!.shape).toBe('line');
  const near = (box: object, want: Record<string, number>) => { for (const [k, v] of Object.entries(want)) expect((box as Record<string, number>)[k]).toBeCloseTo(v, 6); };
  near(by.h1x!.box, { x: 0.1, y: 0.12, w: 0.52, h: 0 });        // left edge to the hole center, at the hole's height
  expect(by.h1y!.shape).toBe('line');
  near(by.h1y!.box, { x: 0.62, y: 0.12, w: 0, h: 0.78 });       // hole center down to the bottom edge
  expect(by.h1d!.shape).toBe('circle');
  expect(by.h1d!.box).toEqual(circle);
});
