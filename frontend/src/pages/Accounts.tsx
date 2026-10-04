import { useState } from 'react';
import { Landmark, CreditCard, PiggyBank, LineChart, Eye, EyeOff, Trash2, RefreshCw, AlertCircle, Building2 } from 'lucide-react';
import type { PageProps } from '../App';
import { useApi } from '../hooks/useApi';
import { api, Account, Item } from '../lib/api';
import { money, relativeTime } from '../lib/format';
import { Card, Badge, Empty, PageHeader, Spinner } from '../components/ui';
import { PlaidLinkButton } from '../components/PlaidLink';

const TYPE_ICON: Record<string, any> = { depository: PiggyBank, credit: CreditCard, loan: Landmark, investment: LineChart };

function StatusBadge({ item }: { item: Item }) {
  if (item.status === 'login_required') return <Badge tone="bad">Reconnect needed</Badge>;
  if (item.status === 'error') return <Badge tone="bad">Error</Badge>;
  if (item.status === 'partial') return <Badge tone="warn">Partial</Badge>;
  return <Badge tone="good">Connected</Badge>;
}

export default function Accounts({ onDataChanged }: PageProps) {
  const { data: items, reload: reloadItems } = useApi<Item[]>('/api/items');
  const { data: accounts, reload: reloadAccounts, setData: setAccounts } = useApi<Account[]>('/api/accounts');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const reload = () => { reloadItems(); reloadAccounts(); };

  const toggleHidden = async (a: Account) => {
    setAccounts((accounts ?? []).map(x => x.account_id === a.account_id ? { ...x, hidden: a.hidden ? 0 : 1 } : x));
    await api(`/api/accounts/${a.account_id}`, { method: 'PATCH', body: { hidden: !a.hidden } });
  };

  const syncItem = async (id: string) => {
    setBusy(id);
    try { await api('/api/sync', { body: { itemId: id } }); } finally { setBusy(null); reload(); }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try { await api(`/api/items/${id}`, { method: 'DELETE' }); } finally { setBusy(null); setConfirming(null); onDataChanged(); }
  };

  return (
    <>
      <PageHeader title="Accounts" subtitle="Bank logins go straight to Plaid. This app only stores a revocable access token — never your passwords."
        actions={
          <>
            <PlaidLinkButton onLinked={onDataChanged}>Connect bank or card</PlaidLinkButton>
            <PlaidLinkButton mode="investments" className="btn-secondary" onLinked={onDataChanged}>Connect investments</PlaidLinkButton>
          </>
        } />

      <p className="-mt-3 mb-5 text-xs text-slate-500">
        Use <span className="text-slate-300">Connect investments</span> for 401(k), IRA and brokerage accounts (Fidelity, Edward Jones, etc.) — they don't support transaction history, so they need a separate connection.
        Re-linking a bank you already connected replaces the old connection instead of duplicating it.
      </p>

      {!items?.length ? (
        <Card><Empty icon={Building2} title="No institutions connected" body="Connect your bank to start pulling balances, transactions and debts." /></Card>
      ) : (
        <div className="space-y-4">
          {items.map(item => {
            const accts = (accounts ?? []).filter(a => a.item_id === item.item_id);
            return (
              <Card key={item.item_id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-5 py-4">
                  <div className="rounded-lg bg-white/[0.05] p-2"><Building2 className="h-4 w-4 text-slate-300" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-100">{item.institution_name}</p>
                      <StatusBadge item={item} />
                      {item.products === 'investments' && <Badge tone="info">Investments</Badge>}
                    </div>
                    <p className="text-xs text-slate-500">{item.account_count} accounts · synced {relativeTime(item.last_synced_at)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {item.status === 'login_required' && (
                      <PlaidLinkButton itemId={item.item_id} className="btn-primary px-3 py-1.5 text-xs" onLinked={reload}>Reconnect</PlaidLinkButton>
                    )}
                    <button className="btn-ghost p-2" onClick={() => syncItem(item.item_id)} disabled={busy === item.item_id} aria-label="Sync">
                      {busy === item.item_id ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
                    </button>
                    {confirming === item.item_id ? (
                      <span className="flex items-center gap-1 text-xs">
                        <span className="text-slate-400">Disconnect and delete its data?</span>
                        <button className="btn px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10" onClick={() => remove(item.item_id)}>Yes</button>
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setConfirming(null)}>No</button>
                      </span>
                    ) : (
                      <button className="btn-ghost p-2 hover:text-rose-400" onClick={() => setConfirming(item.item_id)} aria-label="Disconnect"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                </div>
                {item.error && item.status !== 'ok' && (
                  <div className="flex items-start gap-2 border-b border-white/[0.06] bg-amber-500/[0.04] px-5 py-2 text-xs text-amber-200/80">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {item.error}
                  </div>
                )}
                <ul className="divide-y divide-white/[0.04]">
                  {accts.map(a => {
                    const Icon = TYPE_ICON[a.type] ?? Landmark;
                    const isDebt = a.type === 'credit' || a.type === 'loan';
                    return (
                      <li key={a.account_id} className={`flex items-center gap-3 px-5 py-3 ${a.hidden ? 'opacity-40' : ''}`}>
                        <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-slate-200">{a.name}{a.mask && <span className="text-slate-500"> ••{a.mask}</span>}</p>
                          <p className="text-xs capitalize text-slate-500">{a.subtype ?? a.type}{a.credit_limit ? ` · ${money(a.credit_limit)} limit` : ''}</p>
                        </div>
                        <p className={`text-sm font-semibold tabular-nums ${isDebt ? 'text-rose-400' : 'text-slate-100'}`}>{isDebt ? '−' : ''}{money(Math.abs(a.current_balance), true)}</p>
                        <button className="btn-ghost p-1.5" onClick={() => toggleHidden(a)} title={a.hidden ? 'Include in totals' : 'Exclude from totals'}>
                          {a.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
