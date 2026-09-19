import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { planSchema, type Plan } from '../src/shared/types';

const run = promisify(execFile);
const MODEL = process.env.CODEX_MODEL ?? 'gpt-6-astra';
const VENV_BIN = join(process.cwd(), '.venv', 'bin');

export interface ModelAdapter {
  /** Photos in, plan out. Read-only, structured. */
  plan(photoPaths: string[], prompt: string): Promise<Plan>;
  /** Runs inside runDir with write access; returns when the model stops. Caller inspects the folder. */
  generate(runDir: string, prompt: string, signal: AbortSignal): Promise<void>;
}

const baseFlags = ['--ask-for-approval', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
  '--disable', 'multi_agent', '--disable', 'skill_search', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '--model', MODEL];

export const codex: ModelAdapter = {
  async plan(photoPaths, prompt) {
    const dir = await mkdtemp(join(tmpdir(), 'plan-'));
    try {
      const { $schema, ...schema } = z.toJSONSchema(planSchema);
      const schemaPath = join(dir, 'schema.json'), out = join(dir, 'out.json');
      await writeFile(schemaPath, JSON.stringify(schema));
      const images = photoPaths.flatMap(p => ['--image', p]);
      await run('codex', [...baseFlags, '--sandbox', 'read-only', '--disable', 'shell_tool', '-c', 'model_reasoning_effort="medium"',
        '--cd', dir, '--output-schema', schemaPath, '--output-last-message', out, prompt, ...images], { timeout: 240_000, maxBuffer: 4_000_000 });
      return planSchema.parse(JSON.parse(await readFile(out, 'utf8')));
    } finally { await rm(dir, { recursive: true, force: true }); }
  },
  async generate(runDir, prompt, signal) {
    await run('codex', [...baseFlags, '--sandbox', 'workspace-write', '-c', 'model_reasoning_effort="high"', '--cd', runDir,
      '--output-last-message', join(runDir, 'last.md'), prompt],
      { timeout: 480_000, maxBuffer: 8_000_000, signal, env: { ...process.env, PATH: `${VENV_BIN}:${process.env.PATH}` } });
  },
};

/** Canned outputs from mock/ for UI work and as a demo fallback. MODEL=mock in .env.local. */
export const mock: ModelAdapter = {
  async plan() { return planSchema.parse(JSON.parse(await readFile('mock/plan.json', 'utf8'))); },
  async generate(runDir) { await cp('mock/run', runDir, { recursive: true }); },
};

export const model: ModelAdapter = process.env.MODEL === 'mock' ? mock : codex;
