import { useEffect, useState } from 'react';
import { Search, Receipt } from 'lucide-react';
import type { PageProps } from '../App';
import { useApi } from '../hooks/useApi';
import { api, Transaction } from '../lib/api';
import { money, categoryLabel, dateLabel, monthLabel } from '../lib/format';
import { Card, Badge, Empty, PageHeader, Spinner } from '../components/ui';

const PAGE = 100;

function recentMonths(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
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
  }, [debounced, category, month]);

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
                    <td className="td"><Badge>{categoryLabel(t.category)}</Badge></td>
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
