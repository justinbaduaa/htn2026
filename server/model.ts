import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { askResponseSchema, planSchema, type AskResponse, type Plan } from '../src/shared/types';

const MODEL = process.env.CODEX_MODEL ?? 'gpt-6-astra';
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
  '--disable', 'multi_agent', '--disable', 'skill_search', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '--model', MODEL, '--json'];

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

/** One read-only structured call with photos attached. No shell, no files. */
async function structured<T>(photoPaths: string[], prompt: string, schema: z.ZodType<T>, effort: 'medium' | 'high'): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'ask-'));
  try {
    const { $schema, ...json } = z.toJSONSchema(schema);
    const schemaPath = join(dir, 'schema.json'), out = join(dir, 'out.json');
    await writeFile(schemaPath, JSON.stringify(json));
    const images = photoPaths.flatMap(p => ['--image', p]);
    await runCodex([...baseFlags, '--sandbox', 'read-only', '--disable', 'shell_tool', '-c', `model_reasoning_effort="${effort}"`,
      '--cd', dir, '--output-schema', schemaPath, '--output-last-message', out, prompt, ...images],
      // A full functional decomposition (every button, LED, port, switch as its own reading) ran
      // ~5 min at medium reasoning; plan runs at high now, ask stays at medium so questions answer fast.
      { cwd: dir, eventsPath: join(dir, 'events.jsonl') });
    return schema.parse(JSON.parse(await readFile(out, 'utf8')));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export const codex: ModelAdapter = {
  plan: (photoPaths, prompt) => structured(photoPaths, prompt, planSchema, 'high'),
  ask: (photoPaths, prompt) => structured(photoPaths, prompt, askResponseSchema, 'medium'),
  async generate(runDir, prompt, signal, photoPaths) {
    const images = photoPaths.flatMap(p => ['--image', p]);
    await runCodex([...baseFlags, '--sandbox', 'workspace-write', '-c', 'model_reasoning_effort="xhigh"', '--cd', runDir,
      '--output-last-message', join(runDir, 'last.md'), prompt, ...images],
      { cwd: runDir, eventsPath: join(runDir, 'events.jsonl'), signal, env: { ...process.env, PATH: `${VENV_BIN}:${process.env.PATH}`, CHECK_PYTHON: join(VENV_BIN, 'python') } });
  },
};

export const model: ModelAdapter = codex;
