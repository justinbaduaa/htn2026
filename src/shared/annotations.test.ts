import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dimsFileSchema } from './types';
import { annotate, roleOf } from './annotations';

// dims.json from the real badge run: 48 entered readings, two skipped, parts 100.4 x 153.4 mm.
const dims = dimsFileSchema.parse(JSON.parse(readFileSync('src/app/fixtures/badge-dims.json', 'utf8')));
const set = annotate(dims, { min: [-2.7, -2.7, 0], max: [97.7, 150.7, 10] });
const byId = (id: string) => set.drawn.find(a => a.id === id);

test('reading names map to feature roles', () => {
  expect(roleOf('LCD opening: left X', 'other')).toBe('x');
  expect(roleOf('LCD opening: bottom Y', 'other')).toBe('y');
  expect(roleOf('LCD opening: frame width', 'other')).toBe('w');
  expect(roleOf('Controls opening: cluster height', 'other')).toBe('h');
  expect(roleOf('USB-C port: center Y', 'other')).toBe('cy');
  expect(roleOf('USB-C port: cable plug width along Y', 'other')).toBe('w');
  expect(roleOf('USB-C port: center height above front PCB', 'extent_z')).toBe('z');
  expect(roleOf('Front clearance: tallest component height', 'extent_z')).toBe('z');
  expect(roleOf('Fasteners: screw head height', 'other')).toBe('h');
});

test('part size, outline and every hole are drawn', () => {
  expect(byId('part_x')).toMatchObject({ type: 'dim', text: '100.4 part' });
  expect(byId('board_w')).toMatchObject({ type: 'dim', from: [0, 0, 10.2], to: [95, 0, 10.2] });
  expect(byId('board_h')).toMatchObject({ type: 'dim', from: [95, 0, 10.2], to: [95, 148, 10.2] });
  const holes = set.drawn.filter(a => a.type === 'circle');
  expect(holes).toHaveLength(4);
  expect(byId('hole_h1')).toMatchObject({ center: [18, 143, 10.2], radius: 2.5, text: 'Ø5 at (18, 143)' });
});

test('openings become rectangles, edge features sit on their edge, bare heights are vertical dims', () => {
  expect(byId('LCD opening')).toMatchObject({ type: 'rect', origin: [15, 93, 10.2], w: 51, h: 35, text: 'LCD opening 51×35' });
  expect(byId('Controls opening')).toMatchObject({ type: 'rect', w: 75, h: 39 });
  // USB-C on the left edge: centre Y 84, 12 mm along Y, 7 mm thick, 1.8 mm above the PCB.
  expect(byId('USB-C port')).toMatchObject({ type: 'rect', origin: [-3.5, 78, 10.2], w: 7, h: 12 });
  expect(byId('USB-C port')!.text).toContain('1.8 up');
  // Power switch on the top edge at X 34.
  expect(byId('Top power switch')).toMatchObject({ type: 'rect', origin: [29.5, 146, 10.2], w: 9, h: 4 });
  expect(byId('Front clearance')).toMatchObject({ type: 'dim', axis: 'z', to: [113.7, -2.7, 6] });
  expect(byId('Rear clearance')).toMatchObject({ type: 'dim', axis: 'z', from: [123.7, -2.7, 0], to: [123.7, -2.7, 15] });
});

test('readings with no geometric placement are listed, never silently dropped', () => {
  const ids = set.listed.map(l => l.id);
  expect(ids).toEqual(expect.arrayContaining(['pcb_t', 'head_h', 'nut_h', 'screw_l']));
  const placedIds = new Set(set.drawn.map(a => a.id));
  expect(placedIds.has('lcd_x')).toBe(false);   // atomic readings are folded into their feature
  expect(ids).toHaveLength(4);
  expect(set.drawn.map(a => a.id)).toEqual(['part_x', 'part_y', 'part_z', 'board_w', 'board_h', 'hole_h1', 'hole_h2', 'hole_h3', 'hole_h4',
    'Front clearance', 'Rear clearance', 'LCD opening', 'Controls opening', 'USB-C port', 'Top power switch', 'Left-edge switch', 'Left LED window', 'Right LED window']);
});
