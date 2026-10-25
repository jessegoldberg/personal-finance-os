import { useState } from 'react';
import { Cpu, Sparkles, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import type { PageProps } from '../App';
import { useApi } from '../hooks/useApi';
import { runJob, LocalStatus, UsageRow } from '../lib/api';
import { money } from '../lib/format';
import { Card, CardHeader, Badge, Empty, PageHeader, Spinner, ErrorNote } from '../components/ui';

const FEATURE_LABEL: Record<string, string> = {
  plan: 'AI plan', chat: 'Advisor chat', valuation: 'Home valuation', outlook: 'Market outlook', categorize: 'Categorize transactions', test: 'Connection test',
};
const n = (x: number) => (x ?? 0).toLocaleString('en-US');

function Check({ ok, label }: { ok: boolean; label: string }) {
  return <li className="flex items-center gap-2 text-sm">{ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-rose-400" />}<span className={ok ? 'text-slate-200' : 'text-slate-400'}>{label}</span></li>;
}

export default function AISettings(_: PageProps) {
  const { data: budget } = useApi<{enabled:boolean;reason:string;monthly_limit:number;reserved:number;remaining:number}>('/api/ai/budget');
  const { data: local, reload } = useApi<LocalStatus>('/api/ai/local/status');
  const [days, setDays] = useState(30);
  const { data: usage } = useApi<{ rows: UsageRow[]; total_cost: number }>(`/api/ai/usage?days=${days}`);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string; seconds: number } | null>(null);

  const runTest = async () => {
    setTesting(true); setTest(null);
    const t0 = Date.now();
    try {
      const { reply } = await runJob<{ reply: string }>('/api/ai/local/test');
      setTest({ ok: true, text: reply, seconds: (Date.now() - t0) / 1000 });
    } catch (e: any) {
      setTest({ ok: false, text: e.message, seconds: (Date.now() - t0) / 1000 });
    } finally { setTesting(false); reload(); }
  };

  const claude = (usage?.rows ?? []).filter(r => r.provider === 'claude');
  const localRows = (usage?.rows ?? []).filter(r => r.provider === 'local');
  const saved = claude.reduce((s, r) => s + r.cache_savings, 0);

  return (
    <>
      <PageHeader title="AI & Usage" subtitle="Which model does what, whether your local server is reachable, and what the Claude API is costing you." />

      <Card className="mb-4 p-5">
        <p className="text-sm font-semibold text-white">Paid-analysis allowance</p>
        <p className="mt-2 text-sm text-slate-400">{budget?.reason ?? 'Checking allowance…'}</p>
        {budget&&<p className="mt-2 text-sm text-slate-300">Monthly limit {money(budget.monthly_limit,true)} · Reserved {money(budget.reserved,true)} · Remaining {money(budget.remaining,true)}</p>}
        <p className="mt-2 text-xs text-slate-500">The debt action plan uses no AI credits. Paid reservations use conservative maximums and are kept after errors or restarts. They are not your provider balance or bill. Live paid research is paused.</p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Cpu className="h-4 w-4 text-sky-400" /> Local model (Ollama)</p>
          {!local ? <Spinner className="mt-4 h-4 w-4 text-slate-500" /> : (
            <>
              <ul className="mt-3 space-y-1.5">
                <Check ok={local.enabled} label={local.enabled ? `Configured: ${local.model} at ${local.baseUrl}` : 'Not configured'} />
                {local.enabled && <Check ok={local.reachable} label={local.reachable ? 'Reachable from this app’s server' : 'Not reachable from this app’s server'} />}
                {local.enabled && local.reachable && <Check ok={local.modelInstalled} label={local.modelInstalled ? `${local.model} is installed` : `${local.model} is not installed`} />}
              </ul>
              {local.error && <div className="mt-3"><ErrorNote error={local.error} /></div>}
              {local.installed.length > 0 && <p className="mt-3 text-xs text-slate-500">Installed on the server: {local.installed.join(', ')}</p>}
              {local.enabled && (
                <p className="mt-1 text-xs text-slate-500">Limits: {local.timeoutSeconds}s per request, {local.maxTokens} output tokens, {local.numCtx}-token context, one request at a time
                  {local.busy ? ` · busy now${local.queued ? `, ${local.queued} waiting` : ''}` : ''}.</p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button className="btn-secondary" onClick={runTest} disabled={testing || !local.enabled}>{testing ? <Spinner /> : <Cpu className="h-4 w-4" />} {testing ? 'Testing…' : 'Run a test request'}</button>
                <button className="btn-ghost" onClick={reload}><RefreshCw className="h-4 w-4" /> Recheck</button>
              </div>
              {test && (
                <p className={`mt-2 text-sm ${test.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {test.ok ? `Answered “${test.text}” in ${test.seconds.toFixed(0)}s.` : `Failed after ${test.seconds.toFixed(0)}s: ${test.text}`}
                </p>
              )}
            </>
          )}
        </Card>

        <Card className="p-5">
          <p className="text-sm font-semibold text-slate-100">Who does what</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex justify-between gap-3"><span className="text-slate-400">Quick chat answers</span><Badge tone="info"><Cpu className="h-3 w-3" /> Local (your choice per question)</Badge></li>
            <li className="flex justify-between gap-3"><span className="text-slate-400">Sorting uncategorized purchases</span><Badge tone="info"><Cpu className="h-3 w-3" /> Local</Badge></li>
            <li className="flex justify-between gap-3"><span className="text-slate-400">AI plan, deep chat</span><Badge tone="good"><Sparkles className="h-3 w-3" /> Claude</Badge></li>
            <li className="flex justify-between gap-3"><span className="text-slate-400">Live market research (currently paused)</span><Badge tone="good"><Sparkles className="h-3 w-3" /> Claude</Badge></li>
            <li className="flex justify-between gap-3"><span className="text-slate-400">Balances, payoff math, budgets, detection</span><Badge>Plain code — no AI</Badge></li>
          </ul>
          <p className="mt-4 text-xs text-slate-500">If the local model is down, local features show an error and offer Claude as a button — nothing switches to paid usage on its own.</p>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader title="Usage" subtitle={usage ? `Estimated Claude cost: ${money(usage.total_cost, true)}${saved > 0.005 ? ` · caching saved ${money(saved, true)}` : ''}` : 'Loading…'}
          action={
            <div className="flex rounded-lg border border-white/10 p-0.5">
              {[7, 30, 90].map(d => <button key={d} onClick={() => setDays(d)} className={`rounded-md px-3 py-1 text-xs font-medium ${days === d ? 'bg-white/10 text-white' : 'text-slate-400'}`}>{d}d</button>)}
            </div>
          } />
        {usage?.rows.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-white/[0.06]">
                <tr><th className="th">Feature</th><th className="th">Model</th><th className="th text-right">Requests</th><th className="th text-right">Input</th>
                  <th className="th text-right">Cached</th><th className="th text-right">Output</th><th className="th text-right">Searches</th><th className="th text-right">Avg time</th><th className="th text-right">Est. cost</th></tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {[...claude, ...localRows].map(r => (
                  <tr key={r.provider + r.feature}>
                    <td className="td text-slate-200">{FEATURE_LABEL[r.feature] ?? r.feature}{r.failures ? <span className="ml-2 text-xs text-rose-400">{r.failures} failed</span> : null}</td>
                    <td className="td">{r.provider === 'local' ? <Badge tone="info">Local</Badge> : <Badge tone="good">Claude</Badge>}</td>
                    <td className="td text-right tabular-nums">{n(r.requests)}</td>
                    <td className="td text-right tabular-nums text-slate-400">{n(r.input)}</td>
                    <td className="td text-right tabular-nums text-slate-400">{n(r.cache_read)}</td>
                    <td className="td text-right tabular-nums text-slate-400">{n(r.output)}</td>
                    <td className="td text-right tabular-nums text-slate-400">{n(r.searches)}</td>
                    <td className="td text-right tabular-nums text-slate-400">{r.avg_seconds ? `${r.avg_seconds.toFixed(0)}s` : '—'}</td>
                    <td className="td text-right tabular-nums text-slate-100">{r.provider === 'local' ? 'free' : money(r.cost, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={Sparkles} title="No AI usage recorded yet" body="Usage is tracked from this version on — token counts only, never your prompts or answers." />}
        <p className="border-t border-white/[0.06] px-5 py-3 text-xs text-slate-600">Estimates use list prices for Claude Opus 5.5; your Anthropic console shows the actual bill.</p>
      </Card>
    </>
  );
}
