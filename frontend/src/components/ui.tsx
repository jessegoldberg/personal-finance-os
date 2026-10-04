import { ReactNode } from 'react';
import { Loader2, LucideIcon } from 'lucide-react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const TONES = {
  default: 'text-slate-50',
  good: 'text-emerald-400',
  bad: 'text-rose-400',
  warn: 'text-amber-400',
};

export function Stat({ label, value, hint, icon: Icon, tone = 'default' }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: keyof typeof TONES;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-slate-600" />}
      </div>
      <div className={`mt-2 text-2xl font-semibold tracking-tight ${TONES[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn' | 'info' }) {
  const styles = {
    default: 'bg-white/[0.06] text-slate-300',
    good: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
    bad: 'bg-rose-500/10 text-rose-400 ring-rose-500/20',
    warn: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
    info: 'bg-sky-500/10 text-sky-400 ring-sky-500/20',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-white/5 ${styles}`}>{children}</span>;
}

export function Empty({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-xl bg-white/[0.04] p-3"><Icon className="h-6 w-6 text-slate-500" /></div>
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-slate-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function ProgressBar({ value, max, tone }: { value: number; max: number; tone?: 'good' | 'warn' | 'bad' }) {
  const ratio = max > 0 ? value / max : 0;
  const auto = ratio > 1 ? 'bad' : ratio > 0.85 ? 'warn' : 'good';
  const color = { good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-rose-500' }[tone ?? auto];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>;
}

export const chartTooltip = {
  contentStyle: { background: '#151c2b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 12, color: '#e2e8f0' },
  labelStyle: { color: '#94a3b8', marginBottom: 4 },
  itemStyle: { padding: 0 },
  cursor: { fill: 'rgba(255,255,255,0.03)' },
};
export const axisProps = { stroke: '#475569', fontSize: 11, tickLine: false, axisLine: false } as const;
