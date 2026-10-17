import { useEffect, useState } from 'react';
import { Search, Receipt, Cpu, Undo2 } from 'lucide-react';
import type { PageProps } from '../App';
import { useApi } from '../hooks/useApi';
import { api, runJob, Transaction, LocalStatus, localReady } from '../lib/api';
import { money, categoryLabel, dateLabel, monthLabel } from '../lib/format';
import { Card, Badge, Empty, PageHeader, Spinner, ErrorNote } from '../components/ui';

const PAGE = 100;

function recentMonths(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

type CategorizeResult = { processed: number; updated: number; remaining: number; error: string | null; examples: { description: string; category: string }[] };

// Local-model categorizing of "Other" transactions. User-initiated, results reviewable and undoable.
function Uncategorized({ onChanged }: { onChanged: () => void }) {
  const { data: summary, reload } = useApi<{ count: number; total: number }>('/api/ai/local/categorize');
  const { data: local } = useApi<LocalStatus>('/api/ai/local/status');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CategorizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!summary || (!summary.count && !result)) return null;
  const run = async () => {
    setRunning(true); setError(null);
    try { setResult(await runJob<CategorizeResult>('/api/ai/local/categorize', { limit: 40 })); } catch (e: any) { setError(e.message); }
    finally { setRunning(false); reload(); onChanged(); }
  };
  const undo = async () => { await api('/api/ai/local/categorize/undo', { body: {} }); setResult(null); reload(); onChanged(); };

  return (
    <Card className="mb-4 border-sky-500/20 bg-sky-500/[0.04] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Cpu className="h-5 w-5 text-sky-400" />
        <p className="flex-1 text-sm text-slate-300">
          {summary.count
            ? <><span className="font-semibold text-white">{summary.count}</span> purchases ({money(summary.total)}) in the last 6 months are uncategorized, so they can't count toward budgets.</>
            : 'All recent purchases are categorized.'}
        </p>
        {summary.count > 0 && (
          localReady(local)
            ? <button className="btn-primary" disabled={running} onClick={run}>{running ? <Spinner /> : <Cpu className="h-4 w-4" />}{running ? 'Sorting on your server (≈1 min per 10)…' : `Sort ${Math.min(summary.count, 40)} with local AI`}</button>
            : <span className="text-xs text-slate-500">{local?.error ?? 'Local model not configured'}</span>
        )}
      </div>
      {error && <div className="mt-3"><ErrorNote error={error} /></div>}
      {result && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-slate-300">Categorized {result.updated} of {result.processed}; left {result.processed - result.updated} as Other where it wasn't sure (Zelle, checks, cash).
            {result.error && <span className="text-amber-300"> Stopped early: {result.error} Already-sorted ones were kept.</span>}</p>
          {result.examples.length > 0 && <p className="text-xs text-slate-500">e.g. {result.examples.map(e => `${e.description} → ${categoryLabel(e.category)}`).join(' · ')}</p>}
          <p className="text-xs text-slate-500">Check the ones marked <Badge tone="info">AI</Badge> below and click a category to fix it, or
            <button className="ml-1 inline-flex items-center gap-1 text-sky-400 hover:underline" onClick={undo}><Undo2 className="h-3 w-3" />undo all AI categories</button>.</p>
        </div>
      )}
    </Card>
  );
}

function CategoryCell({ t, categories, onSaved }: { t: Transaction; categories: string[]; onSaved: (c: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select autoFocus className="input w-44 py-1 text-xs" defaultValue={t.category} onBlur={() => setEditing(false)}
        onChange={async e => { await api(`/api/transactions/${t.transaction_id}`, { method: 'PATCH', body: { category: e.target.value } }); onSaved(e.target.value); setEditing(false); }}>
        {categories.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
      </select>
    );
  }
  return (
    <button className="flex items-center gap-1" title="Change category" onClick={() => setEditing(true)}>
      <Badge>{categoryLabel(t.category)}</Badge>
      {t.category_source === 'local_ai' && <Badge tone="info">AI</Badge>}
    </button>
  );
}

export default function Transactions(_: PageProps) {
  const { data: categories } = useApi<string[]>('/api/categories');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [month, setMonth] = useState('');
  const [rows, setRows] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 250); return () => clearTimeout(t); }, [search]);

  const query = (offset: number) => {
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (debounced) p.set('search', debounced);
    if (category) p.set('category', category);
    if (month) p.set('month', month);
    return api<{ rows: Transaction[]; total: number }>(`/api/transactions?${p}`);
  };

  useEffect(() => {
    setLoading(true);
    query(0).then(r => { setRows(r.rows); setTotal(r.total); }).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, category, month, reloadKey]);

  const loadMore = async () => {
    setLoading(true);
    const r = await query(rows.length);
    setRows([...rows, ...r.rows]);
    setLoading(false);
  };

  const out = rows.filter(r => r.amount > 0 && !['TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS'].includes(r.category)).reduce((s, r) => s + r.amount, 0);

  return (
    <>
      <PageHeader title="Transactions" subtitle={`${total.toLocaleString()} transactions${rows.length < total ? ` · showing ${rows.length}` : ''}`} />

      <Uncategorized onChanged={() => setReloadKey(k => k + 1)} />
      <Card className="mb-4 p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_200px_160px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className="input pl-9" placeholder="Search merchant or description…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {(categories ?? []).map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
          </select>
          <select className="input" value={month} onChange={e => setMonth(e.target.value)}>
            <option value="">All months</option>
            {recentMonths(24).map(m => <option key={m} value={m}>{monthLabel(m, true)}</option>)}
          </select>
        </div>
        {(debounced || category || month) && rows.length > 0 && (
          <p className="mt-2 px-1 text-xs text-slate-500">Spending in loaded results: <span className="text-slate-300">{money(out, true)}</span></p>
        )}
      </Card>

      <Card className="overflow-hidden">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead className="border-b border-white/[0.06]">
                <tr><th className="th w-24">Date</th><th className="th">Description</th><th className="th">Category</th><th className="th">Account</th><th className="th text-right">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {rows.map(t => (
                  <tr key={t.transaction_id} className="hover:bg-white/[0.02]">
                    <td className="td text-slate-500">{dateLabel(t.date)}</td>
                    <td className="td">
                      <div className="flex items-center gap-3">
                        {t.logo_url ? <img src={t.logo_url} alt="" className="h-7 w-7 shrink-0 rounded-md bg-white object-contain" />
                          : <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-xs font-semibold text-slate-400">{(t.merchant_name || t.name).slice(0, 1)}</div>}
                        <div className="min-w-0">
                          <p className="truncate text-slate-200">{t.merchant_name || t.name}</p>
                          {t.merchant_name && t.merchant_name !== t.name && <p className="truncate text-xs text-slate-500">{t.name}</p>}
                        </div>
                        {t.pending ? <Badge tone="warn">Pending</Badge> : null}
                      </div>
                    </td>
                    <td className="td"><CategoryCell t={t} categories={categories ?? []} onSaved={c => setRows(rows.map(r => r.transaction_id === t.transaction_id ? { ...r, category: c, category_source: 'user' } : r))} /></td>
                    <td className="td text-slate-500">{t.account_name}{t.mask && ` ••${t.mask}`}</td>
                    <td className={`td text-right font-medium tabular-nums ${t.amount < 0 ? 'text-emerald-400' : 'text-slate-200'}`}>
                      {t.amount < 0 ? '+' : '−'}{money(Math.abs(t.amount), true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : loading ? <div className="flex justify-center py-16"><Spinner className="h-5 w-5 text-slate-500" /></div>
          : <Empty icon={Receipt} title="No transactions found" body="Try a different filter, or sync your accounts." />}
        {rows.length < total && (
          <div className="border-t border-white/[0.06] p-3 text-center">
            <button className="btn-secondary" onClick={loadMore} disabled={loading}>{loading && <Spinner />} Load more</button>
          </div>
        )}
      </Card>
    </>
  );
}
