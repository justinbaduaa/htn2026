import { expect, test } from 'vitest';
import { planSchema, dimsFileSchema, normalizePlan } from './types';

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
