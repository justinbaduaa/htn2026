import { expect, test } from 'vitest';
import { planSchema, dimsFileSchema } from './types';

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
