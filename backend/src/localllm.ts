import { recordUsage } from './ai';

// Local Ollama provider (native /api/chat, for num_ctx/keep_alive control and JSON-schema `format`).
// Never pulls models, never falls back to a paid provider, never logs prompts or responses.
export function localConfig() {
  const keepAlive = process.env.LOCAL_LLM_KEEP_ALIVE ?? '0';
  return {
    provider: (process.env.LOCAL_LLM_PROVIDER || 'none').toLowerCase(),
    baseUrl: (process.env.LOCAL_LLM_BASE_URL || '').replace(/\/+$/, ''),
    model: process.env.LOCAL_LLM_MODEL || '',
    timeoutMs: Number(process.env.LOCAL_LLM_TIMEOUT_MS) || 120_000,
    maxTokens: Number(process.env.LOCAL_LLM_MAX_TOKENS) || 192,
    numCtx: Number(process.env.LOCAL_LLM_NUM_CTX) || 2048,
    keepAlive: /^\d+$/.test(keepAlive) ? Number(keepAlive) : keepAlive,
    maxQueue: Number(process.env.LOCAL_LLM_MAX_QUEUE) || 2,
  };
}

export const localEnabled = () => {
  const c = localConfig();
  return c.provider === 'ollama' && !!c.baseUrl && !!c.model;
};

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

// One active request per app with a small bounded queue: the server is shared and CPU-only.
let active = false;
const waiting: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active) {
    if (waiting.length >= localConfig().maxQueue) throw fail(503, 'The local model is busy with other requests. Try again in a minute.');
    await new Promise<void>(resolve => waiting.push(resolve));
  }
  active = true;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next(); else active = false;
  }
}

async function installedModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: any = await res.json();
  return (data.models ?? []).map((m: any) => m.name);
}

export async function localStatus() {
  const c = localConfig();
  const base = { enabled: localEnabled(), provider: c.provider, baseUrl: c.baseUrl, model: c.model, timeoutSeconds: c.timeoutMs / 1000,
    maxTokens: c.maxTokens, numCtx: c.numCtx, busy: active, queued: waiting.length };
  if (!base.enabled) return { ...base, reachable: false, installed: [] as string[], modelInstalled: false, error: 'Local model not configured (LOCAL_LLM_PROVIDER=ollama, LOCAL_LLM_BASE_URL, LOCAL_LLM_MODEL).' };
  try {
    const installed = await installedModels(c.baseUrl);
    return { ...base, reachable: true, installed, modelInstalled: installed.includes(c.model),
      error: installed.includes(c.model) ? null : `Model "${c.model}" is not installed on the server. Install it there; this app never downloads models.` };
  } catch (e: any) {
    return { ...base, reachable: false, installed: [] as string[], modelInstalled: false, error: `Can't reach ${c.baseUrl} from this server (${e.name === 'TimeoutError' ? 'timed out' : e.message}).` };
  }
}

export interface LocalMessage { role: 'system' | 'user' | 'assistant'; content: string }

export async function localChat(feature: string, messages: LocalMessage[], opts: { format?: object; maxTokens?: number } = {}) {
  if (!localEnabled()) throw fail(503, 'The local model is not configured on the server.');
  const c = localConfig();
  return withSlot(async () => {
    let installed: string[];
    try { installed = await installedModels(c.baseUrl); } catch { throw fail(503, `The local model server at ${c.baseUrl} is unreachable.`); }
    if (!installed.includes(c.model)) throw fail(503, `Model "${c.model}" is not installed on the local server.`);

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${c.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(c.timeoutMs),
        body: JSON.stringify({
          model: c.model, messages, stream: false, keep_alive: c.keepAlive,
          ...(opts.format ? { format: opts.format } : {}),
          options: { num_ctx: c.numCtx, num_predict: opts.maxTokens ?? c.maxTokens, temperature: 0 },
        }),
      });
    } catch (e: any) {
      recordUsage('local', feature, c.model, { seconds: (Date.now() - started) / 1000, ok: false });
      if (e.name === 'TimeoutError' || e.name === 'AbortError') throw fail(504, `The local model didn't answer within ${c.timeoutMs / 1000} seconds.`);
      throw fail(503, 'Lost connection to the local model server.');
    }
    if (!res.ok) {
      recordUsage('local', feature, c.model, { seconds: (Date.now() - started) / 1000, ok: false });
      throw fail(502, `The local model returned an error (HTTP ${res.status}).`);
    }
    const data: any = await res.json();
    recordUsage('local', feature, c.model, {
      input: data.prompt_eval_count, output: data.eval_count, seconds: (data.total_duration ?? 0) / 1e9 || (Date.now() - started) / 1000,
    });
    return { content: String(data.message?.content ?? '').trim(), truncated: data.done_reason === 'length' };
  });
}
