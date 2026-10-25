import { db } from './db';
import { initLedger, reserved, reserve } from './budget-ledger';
import { BUDGET_MONTH, monthlyBudget, requestReservation } from './paid-policy';

// Additive AI accounting only. Never updates accounts, debts or transactions.
initLedger(db);
export function budgetStatus() {
  const cap = monthlyBudget(process.env.PAID_AI_MONTHLY_BUDGET_USD);
  const used = reserved(db,BUDGET_MONTH());
  return { enabled:cap>used && !!process.env.ANTHROPIC_API_KEY,month:BUDGET_MONTH(),
    monthly_limit:cap/1e6,reserved:used/1e6,remaining:Math.max(0,cap-used)/1e6,
    research_enabled:false,accounting:'conservative maximum reservations, not provider billing',
    reason:cap===0 ? 'Paid AI is paused at a $0 monthly limit. The free debt plan remains available.' :
      !process.env.ANTHROPIC_API_KEY ? 'Paid AI is not configured. The free debt plan remains available.' :
      used>=cap ? 'The app monthly AI allowance is exhausted. Use the free debt plan.' : 'Paid analysis is bounded by the remaining app allowance.' };
}
export function requirePaidAllowance() {
  if (!budgetStatus().enabled) throw Object.assign(new Error(budgetStatus().reason),{status:402});
}
export function reservePaid(feature: string,params:any) {
  const amount = requestReservation(params);
  requirePaidAllowance();
  return reserve(db,BUDGET_MONTH(),monthlyBudget(process.env.PAID_AI_MONTHLY_BUDGET_USD),feature,amount);
}
export function finishPaid(id:string,state:'completed'|'unknown') {
  // No automatic refunds: timeouts/restarts can still have incurred provider usage.
  db.prepare('UPDATE ai_budget_reservations SET state=? WHERE id=?').run(state,id);
}
