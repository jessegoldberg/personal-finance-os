import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { money, monthLabel } from '../lib/format';
import { Card, CardHeader, Badge, ErrorNote, Spinner } from './ui';

interface Plan {
  generated_on:string; status:string; monthly_income:number; living_costs:number; planned_expenses:number;
  monthly_tax_reserve:number;tax_reserve_setting:number|null;cash_buffer_setting:number|null;minimum_payments:number; monthly_surplus:number; monthly_shortfall:number; reserve_target:number;
  reserve_gap:number; reserve_contribution:number; extra_payment:number; consumer_balance:number;
  priorities:{id:string;name:string;apr:number|null;minimum:number|null}[];
  scenarios:{method:string;monthly_payment:number;months:number|null;debt_free_month:string|null;total_interest:number|null}[];
  missing_data:string[];warnings:string[];assumptions:string[];
}
export function DebtActionPlan({version=0}:{version?:number}) {
  const {data:plan,error,loading,reload}=useApi<Plan>('/api/advisor/debt-plan',[version]);
  const [buffer,setBuffer]=useState(''),[tax,setTax]=useState(''),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState<string|null>(null);
  useEffect(()=>{if(plan){setBuffer(plan.cash_buffer_setting==null?'':String(plan.cash_buffer_setting));setTax(plan.tax_reserve_setting==null?'':String(plan.tax_reserve_setting));}},[plan]);
  const save=async()=>{setSaving(true);setSaveError(null);try{await api('/api/advisor/plan-assumptions',{method:'PUT',body:{cash_buffer_target:buffer===''?null:Number(buffer),tax_reserve_monthly:tax===''?null:Number(tax)}});await reload();}catch(e:any){setSaveError(e.message);}finally{setSaving(false);}};
  return <Card className="mb-5 border-emerald-500/20">
    <CardHeader title="Your debt action plan" subtitle="Calculated from your accounts. No AI credits or model required."
      action={<button className="btn-secondary text-xs" disabled={loading} onClick={reload}>{loading?<Spinner/>:'Recalculate'}</button>}/>
    <div className="space-y-4 p-5">
      <ErrorNote error={error}/>
      {!plan ? <p className="text-sm text-slate-400">{loading?'Checking your cash flow…':'Your plan could not load. Try recalculating.'}</p> : <>
        <div className="flex flex-wrap items-center gap-3"><Badge tone={plan.status==='ready'?'good':'warn'}>
          {plan.status==='ready'?'Ready to review':plan.status==='no_consumer_debt'?'No non-home debt recorded':plan.status==='cashflow_shortfall'?'Close the monthly gap first':'Verify the missing information'}</Badge>
          <span className="text-xs text-slate-500">As of {plan.generated_on}</span></div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ['Monthly cash flow',money(plan.monthly_surplus)],
            ['Extra debt payment capacity',money(plan.extra_payment)],
            ['Cash buffer target',money(plan.reserve_target)],
            ['This month toward buffer',money(plan.reserve_contribution)],
          ].map(([label,value])=><div key={label}><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-xl font-semibold text-white">{value}</p></div>)}
        </div>
        <p className="text-sm text-slate-400">Income {money(plan.monthly_income)}, less living costs {money(plan.living_costs)}, all debt minimums {money(plan.minimum_payments)} planned expenses {money(plan.planned_expenses)} and additional tax set-aside {money(plan.monthly_tax_reserve)}. Extra capacity also protects the cash buffer. Figures remain provisional until the checks below are resolved.</p>
        {plan.monthly_shortfall>0&&<p className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-200">The monthly gap is {money(plan.monthly_shortfall)}. Extra debt payments are not affordable on the current inputs. First verify the figures, then identify a real spending reduction, additional income or lender arrangement.</p>}
        {plan.missing_data.length>0&&<div><p className="text-sm font-semibold text-amber-200">What to confirm before extra payments</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-100/80">{plan.missing_data.map((text,i)=><li key={i}>{text}</li>)}</ul></div>}
        {plan.status==='ready'&&plan.priorities[0]&&<p className="text-sm text-emerald-200">Keep all minimums covered. The highest-rate non-home debt is {plan.priorities[0].name} ({plan.priorities[0].apr}% APR). Review the monthly capacity above against actual due dates and paydays before making any extra payment.</p>}
        {plan.scenarios.length>0&&<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-slate-500"><tr><th className="py-2">Comparison</th><th>Monthly debt budget</th><th>Estimated payoff</th><th>Estimated interest</th></tr></thead><tbody>{plan.scenarios.map(s=><tr key={s.method} className="border-t border-white/10 text-slate-300"><td className="py-3 capitalize">{s.method==='avalanche'?'Highest interest first':'Smallest balance first'}</td><td>{money(s.monthly_payment)}</td><td>{s.debt_free_month?monthLabel(s.debt_free_month,true):'Not within 50-year horizon'}</td><td>{s.total_interest==null?'Not projected':money(s.total_interest)}</td></tr>)}</tbody></table><p className="mt-2 text-xs text-slate-500">Non-home debts only. All housing debt minimums are still protected in the monthly cash-flow calculation.</p></div>}
        <details className="text-sm text-slate-400"><summary className="cursor-pointer">Confirm your cash buffer and tax set-aside</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><label>Cash buffer target<input type="number" min="0" max="10000000" step="0.01" className="input mt-1" placeholder={`Default: ${plan.reserve_target}`} value={buffer} onChange={e=>setBuffer(e.target.value)}/></label>
          <label>Additional monthly tax set-aside<input type="number" min="0" max="10000000" step="0.01" className="input mt-1" placeholder="Not confirmed" value={tax} onChange={e=>setTax(e.target.value)}/></label></div>
          <p className="my-2 text-xs">Use take-home income. Enter only taxes not already deducted from that amount; enter 0 if covered elsewhere. Blank resets the cash target to its default or leaves tax coverage unconfirmed. Saving changes planning assumptions only, never your accounts.</p>
          <button className="btn-secondary" disabled={saving} onClick={save}>{saving?'Saving…':'Save assumptions'}</button><ErrorNote error={saveError}/>
        </details>
        <details className="text-sm text-slate-400"><summary className="cursor-pointer">Assumptions and limitations</summary><ul className="mt-2 list-disc space-y-1 pl-5">{[...plan.warnings,...plan.assumptions].map((text,i)=><li key={i}>{text}</li>)}</ul></details>
        <p className="text-xs text-slate-500">This is a monthly planning aid. It does not move money, change budgets or replace reviewing your statements.</p>
      </>}
    </div>
  </Card>;
}
