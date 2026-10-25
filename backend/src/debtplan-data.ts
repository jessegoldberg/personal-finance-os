import { db, getSetting } from './db';
import { getOverview } from './analytics';
import { listPlanned } from './planner';
import { debtActionPlan, PlanDebt } from './debtplan';

export function currentDebtPlan() {
  // Read-only. No model calls, refreshes, balance changes or payment instructions.
  const overview = getOverview();
  const secured = new Set<string>();
  for (const property of db.prepare('SELECT debt_ids FROM properties').all()) {
    for (const id of JSON.parse(property.debt_ids || '[]')) secured.add(id);
  }
  const debts: PlanDebt[] = db.prepare(`SELECT d.* FROM debts d LEFT JOIN accounts a USING(account_id)
    WHERE COALESCE(a.hidden,0)=0 AND d.balance>0`).all().map((d:any) => ({...d,
      home_secured:secured.has(d.id) || /mortgage|heloc|home.?equity/i.test(d.kind)}));
  const history = db.prepare(`SELECT COUNT(DISTINCT substr(t.date,1,7)) AS months FROM transactions t
    JOIN accounts a USING(account_id) WHERE a.hidden=0 AND t.amount>0 AND t.pending=0
    AND t.category NOT IN ('TRANSFER_IN','TRANSFER_OUT','LOAN_PAYMENTS','INCOME')
    AND t.date>=date('now','start of month','-3 months') AND t.date<date('now','start of month')`).get().months;
  const cash = db.prepare("SELECT current_balance,available_balance FROM accounts WHERE hidden=0 AND type='depository'")
    .all().reduce((s:number,a:any) => s+Math.min(a.current_balance ?? 0,a.available_balance ?? a.current_balance ?? 0),0);
  const staleAccounts = db.prepare(`SELECT a.name, CASE WHEN a.item_id='manual' THEN a.updated_at ELSE i.last_synced_at END AS checked
    FROM accounts a LEFT JOIN items i USING(item_id) WHERE a.hidden=0 AND a.type IN ('depository','credit','loan')`).all()
    .filter((a:any) => !a.checked || !Number.isFinite(Date.parse(a.checked)) || Date.now()-Date.parse(a.checked)>35*864e5)
    .map((a:any) => a.name);
  const date = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const setting = (key:string) => { const value=getSetting(key); if(value==null || value==='')return null; const n=Number(value); if(!Number.isFinite(n)||n<0)throw new Error('Review saved plan assumptions.'); return n; };
  const untaxedIncome=db.prepare('SELECT COALESCE(SUM(monthly_amount),0) AS n FROM income_sources WHERE taxes_withheld=0').get().n;
  return {...debtActionPlan({date,income:overview.monthlyIncome,incomeSource:overview.incomeSource,
    spending:overview.avgMonthlySpending,planned:overview.plannedMonthly,cash,historyMonths:history,
    debts,staleAccounts,untaxedIncome,taxReserve:setting('debt_plan_tax_reserve_monthly'),
    cashBufferTarget:setting('debt_plan_cash_buffer_target'),unbudgetedEvents:listPlanned().totals.missing_amounts}),
    household_notes:getSetting('household_notes') ?? ''};
}
