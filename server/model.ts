import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import type { ZodType } from 'zod';
import { askResponseSchema, planSchema, type AskResponse, type Plan } from '../src/shared/types';

const CODEX_MODEL = process.env.CODEX_MODEL ?? 'gpt-6-astra';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? CODEX_MODEL;
const VENV_BIN = join(process.cwd(), '.venv', 'bin');

export interface ModelAdapter {
  /** Photos in, plan out. Read-only, structured. */
  plan(photoPaths: string[], prompt: string): Promise<Plan>;
  /** Answers a question about one requested dimension, with the photos in view. */
  ask(photoPaths: string[], prompt: string): Promise<AskResponse>;
  /** Runs inside runDir with write access; returns when the model stops. Caller inspects the folder. Photos let it place callouts if it asks for more. */
  generate(runDir: string, prompt: string, signal: AbortSignal, photoPaths: string[]): Promise<void>;
}

const baseFlags = ['--ask-for-approval', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
  '--disable', 'multi_agent', '--disable', 'skill_search', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '--model', CODEX_MODEL, '--json'];

/**
 * Runs codex exec with stdin closed. Codex reads extra prompt text from stdin when it is not a TTY,
 * and an open pipe makes it wait forever. JSON events stream to eventsPath for debugging.
 */
function runCodex(args: string[], opts: { cwd: string; eventsPath: string; signal?: AbortSignal; env?: NodeJS.ProcessEnv }) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('codex', args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: opts.env ?? process.env, signal: opts.signal });
    const events = createWriteStream(opts.eventsPath);
    child.stdout.pipe(events);
    // Codex reports API failures (usage limits, auth, bad images) as JSON events on stdout, not on stderr.
    let modelError = '';
    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          const message: unknown = e?.type === 'turn.failed' ? e.error?.message : e?.type === 'error' ? e.message : undefined;
          if (typeof message === 'string' && !message.startsWith('Skill descriptions')) modelError = message;
        } catch { /* not JSON */ }
      }
    });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    // No timeout: high reasoning efforts can legitimately run a long time, so the model finishes or the caller aborts via signal.
    child.on('error', error => { reject(error); });
    child.on('close', code => {
      if (code === 0) { resolve(); return; }
      // Drop the benign stdin notice so the real reason is what the user sees.
      const lines = stderr.trim().split('\n').filter(l => l.trim() && !l.includes('Reading additional input from stdin'));
      reject(new Error(modelError || `codex exited ${code}: ${lines.slice(-6).join(' | ').slice(0, 800) || '(no stderr)'}`));
    });
  });
}

type ResponsesRequest = Parameters<OpenAI['responses']['parse']>[0];
type ResponsesClient = {
  responses: {
    parse(request: ResponsesRequest): Promise<{ output_parsed: unknown; output_text?: string }>;
  };
};

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set. Add it to .env before analyzing photos.');
  return openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 420_000 });
}

function imageMime(data: Buffer): string {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.subarray(0, 6).toString('ascii') === 'GIF87a' || data.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  throw new Error('Unsupported photo format. Use JPEG, PNG, GIF, or WebP.');
}

export async function imageDataUrl(path: string): Promise<string> {
  const data = await readFile(path);
  return `data:${imageMime(data)};base64,${data.toString('base64')}`;
}

/** A bounded vision request: photos in, schema-validated JSON out. No local tools or file writes. */
export async function responsesStructured<T>(photoPaths: string[], prompt: string, schema: ZodType<T>, schemaName: string,
  client: ResponsesClient = getOpenAI(), effort: 'medium' | 'high' = 'medium'): Promise<T> {
  const images = await Promise.all(photoPaths.map(async path => ({
    type: 'input_image' as const,
    image_url: await imageDataUrl(path),
    detail: 'high' as const,
  })));
  const response = await client.responses.parse({
    model: OPENAI_MODEL,
    reasoning: { effort },
    store: false,
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images] }],
    text: { format: zodTextFormat(schema, schemaName) },
  });
  if (response.output_parsed == null) throw new Error(`The Responses API returned no structured output. ${response.output_text ?? ''}`.trim());
  return schema.parse(response.output_parsed);
}

export const responses: Pick<ModelAdapter, 'plan' | 'ask'> = {
  plan: (photoPaths, prompt) => responsesStructured(photoPaths, prompt, planSchema, 'cad_measurement_plan', getOpenAI(), 'high'),
  ask: (photoPaths, prompt) => responsesStructured(photoPaths, prompt, askResponseSchema, 'measurement_clarification'),
};

export const codex: Pick<ModelAdapter, 'generate'> = {
  async generate(runDir, prompt, signal, photoPaths) {
    const images = photoPaths.flatMap(p => ['--image', p]);
    await runCodex([...baseFlags, '--sandbox', 'workspace-write', '-c', 'model_reasoning_effort="xhigh"', '--cd', runDir,
      '--output-last-message', join(runDir, 'last.md'), prompt, ...images],
      { cwd: runDir, eventsPath: join(runDir, 'events.jsonl'), signal, env: { ...process.env, PATH: `${VENV_BIN}:${process.env.PATH}`, CHECK_PYTHON: join(VENV_BIN, 'python') } });
  },
};

export const model: ModelAdapter = { ...responses, ...codex };
