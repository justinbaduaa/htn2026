// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DrawingViews } from './DrawingViews';
import type { CadGeometry } from '../shared/cadGeometry';
const mocks = vi.hoisted(() => ({ geometry: vi.fn(), loadParts: vi.fn(), renderDrawings: vi.fn() }));
vi.mock('../shared/api', () => ({ api: { geometry: mocks.geometry } }));
vi.mock('./scene', () => ({ loadParts: mocks.loadParts }));
vi.mock('./drawings', () => ({ renderDrawings: mocks.renderDrawings }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const meta = { projectId: 'p', run: 0, title: 'Part' };
const parts = [{ name: 'part', url: 'part.stl' }];
const geometry: CadGeometry = { source: 'STEP', units: 'mm', parts: [] };
function client() { return new QueryClient({ defaultOptions: { queries: { retry: false } } }); }

test('missing geometry is fetched before loading or rendering drawings', async () => {
  let resolve!: (value: CadGeometry) => void;
  mocks.geometry.mockReturnValue(new Promise<CadGeometry>(r => { resolve = r; }));
  mocks.loadParts.mockResolvedValue([]);
  mocks.renderDrawings.mockResolvedValue([]);
  render(<QueryClientProvider client={client()}><DrawingViews parts={parts} meta={meta} /></QueryClientProvider>);
  expect(screen.getByRole('status').textContent).toContain('Loading CAD measurements');
  expect(mocks.loadParts).not.toHaveBeenCalled();
  expect(mocks.renderDrawings).not.toHaveBeenCalled();
  await act(async () => resolve(geometry));
  await waitFor(() => expect(mocks.renderDrawings).toHaveBeenCalledWith([], geometry, meta));
  expect(mocks.geometry).toHaveBeenCalledWith('p', 0);
});

test('discarded loads cannot render with stale props and release their meshes', async () => {
  let resolve!: (value: unknown[]) => void;
  const dispose = vi.fn();
  mocks.loadParts.mockReturnValue(new Promise<unknown[]>(r => { resolve = r; }));
  const view = render(<QueryClientProvider client={client()}><DrawingViews parts={parts} geometry={geometry} meta={meta} /></QueryClientProvider>);
  view.unmount();
  await act(async () => resolve([{ geometry: { dispose } }]));
  expect(mocks.renderDrawings).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledOnce();
  expect(mocks.geometry).not.toHaveBeenCalled();
});
