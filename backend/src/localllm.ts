import { recordUsage } from './ai';
import { gatewayRequest, gatewayFormat, gatewayPromptBytes } from './localgateway';

// Native Ollama or the authenticated private OpenAI-compatible gateway.
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
    maxPromptBytes: 2048,
    keepAlive: /^\d+$/.test(keepAlive) ? Number(keepAlive) : keepAlive,
    maxQueue: Number(process.env.LOCAL_LLM_MAX_QUEUE) || 2,
  };
}

export const localEnabled = () => {
  const c = localConfig();
  return ['ollama', 'gateway'].includes(c.provider) && !!c.baseUrl && !!c.model
    && (c.provider !== 'gateway' || !!process.env.LOCAL_LLM_CREDENTIAL_FILE && !!process.env.LOCAL_LLM_CA_CERT_FILE);
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
  if (localConfig().provider === 'gateway') {
    const data = await gatewayRequest(baseUrl, '/models', 5000);
    if (!Array.isArray(data.data) || data.data.some((m: any) => typeof m?.id !== 'string')) throw fail(502, 'The local gateway returned an invalid model list.');
    return data.data.map((m: any) => m.id);
  }
  const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: any = await res.json();
  return (data.models ?? []).map((m: any) => m.name);
}

export async function localStatus() {
  const c = localConfig();
  let publicUrl = c.baseUrl;
  if (c.provider === 'gateway') {
    try { const url = new URL(c.baseUrl); publicUrl = url.origin + url.pathname; } catch { publicUrl = '(invalid gateway URL)'; }
  }
  const base = { enabled: localEnabled(), provider: c.provider, baseUrl: publicUrl, model: c.model, timeoutSeconds: c.timeoutMs / 1000,
    maxTokens: c.maxTokens, numCtx: c.numCtx, maxPromptBytes: c.maxPromptBytes, busy: active, queued: waiting.length };
  if (!base.enabled) return { ...base, reachable: false, installed: [] as string[], modelInstalled: false, error: 'Local model not configured. Select a provider, URL and model; gateway mode also needs a credential file and trusted CA.' };
  try {
    const installed = await installedModels(c.baseUrl);
    return { ...base, reachable: true, installed, modelInstalled: installed.includes(c.model),
      error: installed.includes(c.model) ? null : `Model "${c.model}" is not available to this app. Check its installation or gateway permission; this app never downloads models.` };
  } catch (e: any) {
    return { ...base, reachable: false, installed: [] as string[], modelInstalled: false, error: c.provider === 'gateway' ? (e.status ? e.message : 'Cannot reach the local gateway with verified TLS.') : `Can't reach ${c.baseUrl} from this server (${e.name === 'TimeoutError' ? 'timed out' : e.message}).` };
  }
}

export interface LocalMessage { role: 'system' | 'user' | 'assistant'; content: string }

export async function localChat(feature: string, messages: LocalMessage[], opts: { format?: object; maxTokens?: number } = {}) {
  if (!localEnabled()) throw fail(503, 'The local model is not configured on the server.');
  const c = localConfig();
  return withSlot(async () => {
    if (c.provider === 'gateway') {
      const maxTokens = opts.maxTokens ?? c.maxTokens;
      if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1024) throw fail(413, 'The local gateway output limit is 1024 tokens.');
      if (gatewayPromptBytes(messages, opts.format) > c.maxPromptBytes) throw fail(413, 'This request exceeds the local gateway prompt limit. Ask a shorter question.');
      const started = Date.now();
      try {
        const data = await gatewayRequest(c.baseUrl, '/chat/completions', Math.min(c.timeoutMs, 120_000), {
          model: c.model, messages, stream: false, max_tokens: maxTokens, temperature: 0,
          ...(opts.format ? { response_format: gatewayFormat(opts.format) } : {}),
        });
        const choice = data.choices?.[0];
        if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim() || choice.message.tool_calls?.length) throw fail(502, 'The local gateway did not return a text answer.');
        recordUsage('local', feature, c.model, { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens, seconds: (Date.now() - started) / 1000 });
        return { content: choice.message.content.trim(), truncated: choice.finish_reason === 'length' };
      } catch (error: any) {
        recordUsage('local', feature, c.model, { seconds: (Date.now() - started) / 1000, ok: false });
        throw error?.status ? error : fail(503, 'The local gateway request failed.');
      }
    }
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
