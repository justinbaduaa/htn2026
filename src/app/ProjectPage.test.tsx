// @vitest-environment jsdom
import { beforeAll, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { projectSchema } from '../shared/types';

// A real plan the model produced for the HTN badge: 50 readings across four photos, several groups spanning photos.
const project = projectSchema.parse(JSON.parse(readFileSync('src/app/fixtures/badge-project.json', 'utf8')));
vi.mock('../shared/api', () => ({ api: { get: async () => project, fileUrl: () => 'x.jpg' } }));
vi.mock('./Viewer', () => ({ Viewer: () => null }));   // no WebGL in jsdom

beforeAll(() => {
  // jsdom has no layout, so the photo reports no size and the SVG overlay is never drawn.
  Object.defineProperty(HTMLImageElement.prototype, 'clientWidth', { get: () => 800 });
  Object.defineProperty(HTMLImageElement.prototype, 'clientHeight', { get: () => 600 });
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
});

const fullShapes = () => [...document.querySelectorAll('svg [opacity="1"]')];

async function mount() {
  const { ProjectPage } = await import('./ProjectPage');
  render(<QueryClientProvider client={new QueryClient()}><ProjectPage id={project.id} /></QueryClientProvider>);
  await screen.findByText('LCD opening');
}

test('hovering a group lights every callout of that group', async () => {
  await mount();
  fireEvent.mouseEnter(screen.getByText('LCD opening'));
  expect(fullShapes().length).toBe(4);
  cleanup();
});

test('hovering one reading inside an open group lights only that callout', async () => {
  await mount();
  const header = screen.getByText('LCD opening');
  fireEvent.click(header);
  fireEvent.mouseLeave(header);
  const row = screen.getByText('LCD opening: frame width').closest('div[class*="ml-5"]')!;
  fireEvent.mouseEnter(row);
  const full = fullShapes();
  expect(full.length).toBe(1);
  expect(full[0]!.tagName.toLowerCase()).toBe('g');   // a line callout is a <g> of three lines
  cleanup();
});

test('hovering a reading whose callout is on another photo switches to that photo and lights it', async () => {
  await mount();
  // The USB-C group has three callouts on the side photo (2) and one on the top photo (0).
  const header = screen.getByText('USB-C port');
  fireEvent.click(header);
  fireEvent.mouseLeave(header);
  const row = screen.getByText('USB-C port: center Y').closest('div[class*="ml-5"]')!;
  fireEvent.mouseEnter(row);
  expect(fullShapes().length).toBe(1);
  expect(fullShapes()[0]!.tagName.toLowerCase()).toBe('rect');
  cleanup();
});
