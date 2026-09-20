import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { planSchema } from '../src/shared/types';
import { imageDataUrl, responsesStructured } from './model';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function pngFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'cadex-response-test-'));
  temporary.push(dir);
  const path = join(dir, 'photo.jpg');
  await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
  return path;
}

test('encodes photos by their actual format, not their stored extension', async () => {
  const url = await imageDataUrl(await pngFixture());
  expect(url).toMatch(/^data:image\/png;base64,/);
});

test('sends photos to Responses API and validates the structured plan', async () => {
  const plan = { title: 'Badge case', summary: 'A fitted case', parts: [], dimensions: [], question: '' };
  const parse = vi.fn(async (_request: unknown) => ({ output_parsed: plan, output_text: JSON.stringify(plan) }));

  const result = await responsesStructured([await pngFixture()], 'Plan this part', planSchema, 'cad_measurement_plan', { responses: { parse } });

  expect(result.title).toBe('Badge case');
  expect(parse).toHaveBeenCalledOnce();
  const request = parse.mock.calls[0]![0] as {
    store: boolean;
    input: Array<{ content: Array<{ type: string; text?: string; image_url?: string }> }>;
  };
  expect(request.store).toBe(false);
  const message = request.input[0]!;
  expect(message.content[0]).toEqual({ type: 'input_text', text: 'Plan this part' });
  expect(message.content[1]!.image_url).toMatch(/^data:image\/png;base64,/);
});
