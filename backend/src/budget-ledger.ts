import { randomUUID } from 'crypto';
// Small SQLite adapter shared by production and synthetic integration tests.
export function initLedger(db:any) {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_budget_reservations (
    id TEXT PRIMARY KEY, month TEXT NOT NULL, feature TEXT NOT NULL,
    reserved_micro_usd INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'reserved',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ); CREATE INDEX IF NOT EXISTS idx_ai_budget_month ON ai_budget_reservations(month);`);
}
export function reserved(db:any,month:string):number {
  return db.prepare('SELECT COALESCE(SUM(reserved_micro_usd),0) AS n FROM ai_budget_reservations WHERE month=?').get(month).n;
}
export function reserve(db:any,month:string,cap:number,feature:string,amount:number):string {
  if (!Number.isSafeInteger(cap) || cap<=0 || !Number.isSafeInteger(amount) || amount<=0) {
    throw Object.assign(new Error('Paid analysis is paused. The free debt plan remains available.'),{status:402});
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (reserved(db,month)+amount>cap) throw Object.assign(new Error('This request exceeds the remaining app AI allowance. No paid request was sent.'),{status:402});
    const id=randomUUID();
    db.prepare('INSERT INTO ai_budget_reservations(id,month,feature,reserved_micro_usd) VALUES(?,?,?,?)').run(id,month,feature,amount);
    db.exec('COMMIT');return id;
  } catch(error) { db.exec('ROLLBACK');throw error; }
}
