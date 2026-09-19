import { expect, test } from 'vitest';
import { buildDims } from './generate';
import { projectSchema, type Project } from '../src/shared/types';

const dim = (id: string, priority: 'required' | 'recommended' | 'optional', default_mm: number | null, extra: Partial<Project['plan'] extends infer P ? P extends { dimensions: (infer D)[] } ? D : never : never> = {}) =>
  ({ id, name: id, why: '', critical: priority === 'required', priority, kind: 'other', hole: null, group: null, photo: 0, shape: 'none', box: { x: 0, y: 0, w: 0, h: 0 }, default_mm, ...extra });

const base = () => projectSchema.parse({
  id: 'p', title: 't', created: '', photos: ['0.jpg'], plan: { title: 't', summary: '', parts: [], question: '',
    dimensions: [dim('w', 'required', 60), dim('lcd_w', 'recommended', 30), dim('lcd_h', 'recommended', null), dim('fillet', 'optional', 2)] },
  values: { w: 61 }, extra: [], skipped: [], notes: '', runs: [],
});

test('blank recommended readings fall back to the plan default, flagged as estimated', () => {
  const dims = buildDims(base()).dimensions;
  expect(dims.map(d => [d.id, d.value_mm, d.estimated])).toEqual([['w', 61, false], ['lcd_w', 30, true], ['fillet', 2, true]]);
});

test('skipped readings are left out entirely and listed for the model', () => {
  const project = base();
  project.skipped = ['lcd_w', 'fillet'];
  const dims = buildDims(project);
  expect(dims.dimensions.map(d => d.id)).toEqual(['w']);
  expect(dims.skipped).toEqual(['lcd_w', 'fillet']);
});

test('a required reading that is neither entered nor skipped blocks the run', () => {
  const project = base();
  project.values = {};
  expect(() => buildDims(project)).toThrow(/Missing required dimension: w/);
  project.skipped = ['w'];
  expect(() => buildDims(project)).not.toThrow();
});
