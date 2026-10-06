// Long AI tasks run in the background because Cloudflare Access cuts proxied requests off at ~100s.
interface Job { status: 'running' | 'done' | 'error'; result?: unknown; error?: string; startedAt: number }

const jobs = new Map<string, Job>();
const running = new Map<string, string>();

export function startJob(kind: string, fn: () => Promise<unknown>, singleton = true): string {
  if (singleton && running.has(kind)) return running.get(kind)!;
  const id = `${kind}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  jobs.set(id, { status: 'running', startedAt: Date.now() });
  if (singleton) running.set(kind, id);
  fn().then(
    result => jobs.set(id, { status: 'done', result, startedAt: jobs.get(id)!.startedAt }),
    err => jobs.set(id, { status: 'error', error: err?.message || 'Failed', startedAt: jobs.get(id)!.startedAt }),
  ).finally(() => { if (running.get(kind) === id) running.delete(kind); });

  for (const [k, j] of jobs) if (Date.now() - j.startedAt > 3600_000) jobs.delete(k);
  return id;
}

export function getJob(id: string) {
  return jobs.get(id) ?? null;
}
