import { useEffect, useState } from 'react';
import { LayoutDashboard, Receipt, PieChart, TrendingDown, Wallet, Sparkles, Landmark, RefreshCw, Menu, X, Home as HomeIcon, CalendarHeart } from 'lucide-react';
import { api } from './lib/api';
import { relativeTime } from './lib/format';
import { Spinner } from './components/ui';
import { PlaidOAuthResume } from './components/PlaidLink';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Spending from './pages/Spending';
import Debts from './pages/Debts';
import Income from './pages/Income';
import Advisor from './pages/Advisor';
import Accounts from './pages/Accounts';
import Home from './pages/Home';
import PlanAhead from './pages/PlanAhead';

const PAGES = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, Component: Dashboard },
  { id: 'advisor', label: 'AI Advisor', icon: Sparkles, Component: Advisor },
  { id: 'debt', label: 'Debt Plan', icon: TrendingDown, Component: Debts },
  { id: 'plan', label: 'Plan Ahead', icon: CalendarHeart, Component: PlanAhead },
  { id: 'home', label: 'Home & Equity', icon: HomeIcon, Component: Home },
  { id: 'spending', label: 'Spending & Budgets', icon: PieChart, Component: Spending },
  { id: 'transactions', label: 'Transactions', icon: Receipt, Component: Transactions },
  { id: 'income', label: 'Income', icon: Wallet, Component: Income },
  { id: 'accounts', label: 'Accounts', icon: Landmark, Component: Accounts },
] as const;

export type PageId = typeof PAGES[number]['id'];
export const navigate = (id: PageId) => { window.location.hash = `/${id}`; };

const currentPage = () => (PAGES.find(p => `#/${p.id}` === window.location.hash)?.id ?? 'overview') as PageId;

export default function App() {
  const [page, setPage] = useState<PageId>(currentPage);
  const [version, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onHash = () => { setPage(currentPage()); setMenuOpen(false); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    api<{ t: string | null }[]>('/api/items').then(items => {
      const latest = items.map((i: any) => i.last_synced_at).filter(Boolean).sort().pop();
      setLastSynced(latest ?? null);
    }).catch(() => {});
  }, [version]);

  const refresh = () => setVersion(v => v + 1);
  const sync = async () => {
    setSyncing(true);
    try { await api('/api/sync', { body: {} }); } finally { setSyncing(false); refresh(); }
  };

  const Active = PAGES.find(p => p.id === page)!.Component;

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {PAGES.map(p => (
        <a key={p.id} href={`#/${p.id}`}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
            page === p.id ? 'bg-white/[0.07] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'}`}>
          <p.icon className={`h-4 w-4 ${page === p.id ? 'text-emerald-400' : ''}`} />
          {p.label}
        </a>
      ))}
    </nav>
  );

  const syncBox = (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-xs text-slate-500">Last synced {relativeTime(lastSynced)}</p>
      <button className="btn-secondary mt-2 w-full" onClick={sync} disabled={syncing}>
        {syncing ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {syncing ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-2.5 px-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 text-ink-950">
        <TrendingDown className="h-4 w-4 -scale-y-100" strokeWidth={2.5} />
      </div>
      <div>
        <div className="text-sm font-semibold text-white">Family Finance</div>
        <div className="text-[11px] text-slate-500">Debt-free plan</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-full">
      <PlaidOAuthResume onLinked={refresh} />

      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col justify-between border-r border-white/[0.06] bg-ink-950 p-4 lg:flex">
        <div className="space-y-6">{brand}{nav}</div>
        {syncBox}
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.06] bg-ink-950/90 px-4 py-3 backdrop-blur lg:hidden">
        {brand}
        <button className="btn-ghost" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>
      {menuOpen && (
        <div className="fixed inset-x-0 top-[57px] z-20 space-y-4 border-b border-white/[0.06] bg-ink-950 p-4 lg:hidden">{nav}{syncBox}</div>
      )}

      <main className="px-4 py-6 sm:px-8 lg:ml-60 lg:py-8">
        <div className="mx-auto max-w-7xl">
          <Active key={version} onDataChanged={refresh} />
        </div>
      </main>
    </div>
  );
}

export interface PageProps { onDataChanged: () => void }
