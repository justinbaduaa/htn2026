// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewProject } from './NewProject';

const api = vi.hoisted(() => ({ create: vi.fn(), plan: vi.fn() }));
vi.mock('../shared/api', () => ({ api }));
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><NewProject /></QueryClientProvider>);
}
function attach() {
  fireEvent.change(screen.getByLabelText('Attach object photos'), { target: { files: [new File(['photo'], 'part.png', { type: 'image/png' })] } });
}
test('requires a prompt and photo, and supports removing an attachment', () => {
  mount();
  const submit = screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Describe your project'), { target: { value: 'A case for my board' } });
  expect(submit.disabled).toBe(true);
  attach();
  expect(submit.disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Remove part.png' }));
  expect(submit.disabled).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
});
test('retries a failed analysis without creating a duplicate project', async () => {
  api.create.mockResolvedValue({ id: 'new-part' });
  api.plan.mockRejectedValueOnce(new Error('Analysis unavailable')).mockResolvedValueOnce({});
  mount();
  fireEvent.change(screen.getByLabelText('Describe your project'), { target: { value: 'A fitted case' } });
  attach();
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  await waitFor(() => expect(location.hash).toBe('#p/new-part'));
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(api.plan).toHaveBeenCalledTimes(2);
});

test('keeps more than four photos and allows adding more', async () => {
  api.create.mockResolvedValue({ id: 'many-photos' });
  api.plan.mockResolvedValue({});
  mount();
  fireEvent.change(screen.getByLabelText('Describe your project'), { target: { value: 'A case' } });
  const files = Array.from({ length: 6 }, (_, i) => new File(['photo'], `view-${i}.png`, { type: 'image/png' }));
  fireEvent.change(screen.getByLabelText('Attach object photos'), { target: { files } });
  expect(screen.getAllByRole('img')).toHaveLength(6);
  expect((screen.getByRole('button', { name: /Add photos/ }) as HTMLButtonElement).disabled).toBe(false);
  attach();
  expect(screen.getAllByRole('img')).toHaveLength(7);
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  await waitFor(() => expect(api.create).toHaveBeenCalled());
  expect(api.create.mock.calls[0]![0]).toHaveLength(7);
  await waitFor(() => expect(location.hash).toBe('#p/many-photos'));
});
