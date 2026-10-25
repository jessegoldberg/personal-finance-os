// Run only in a disposable candidate container. Refuse production databases.
const assert=require('node:assert/strict');
if(process.env.DATABASE_URL!=='sqlite:////tmp/acceptance.sqlite' || process.env.PAID_AI_MONTHLY_BUDGET_USD!=='0' || process.env.FINANCE_STARTUP_REFRESH_ENABLED!=='false')throw new Error('Disposable acceptance profile required.');
(async()=>{
 const root='http://127.0.0.1:3000';
 const request=async(path,body)=>{const r=await fetch(root+path,body?{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return [r,await r.json()]};
 let [r,plan]=await request('/api/advisor/debt-plan');assert.equal(r.status,200);assert.equal(plan.paid_credits_required,false);
 assert.equal(plan.status,'no_consumer_debt');
 let [,budget]=await request('/api/ai/budget');assert.equal(budget.enabled,false);assert.equal(budget.monthly_limit,0);
 [r]=await request('/api/advisor/plan-assumptions',{cash_buffer_target:-1,tax_reserve_monthly:0});assert.equal(r.status,400);
 [r]=await request('/api/advisor/plan-assumptions',{cash_buffer_target:1500,tax_reserve_monthly:0});assert.equal(r.status,200);
 [,plan]=await request('/api/advisor/debt-plan');assert.equal(plan.reserve_target,1500);assert.equal(plan.tax_reserve_setting,0);
 await request('/api/advisor/plan-assumptions',{cash_buffer_target:null,tax_reserve_monthly:null});
 const D=require('/app/backend/node_modules/better-sqlite3');const db=new D('/tmp/acceptance.sqlite');
 db.prepare("INSERT INTO accounts(account_id,item_id,name,type,current_balance,available_balance) VALUES('cash','manual','Synthetic cash','depository',4000,4000)").run();
 db.prepare("INSERT INTO accounts(account_id,item_id,name,type,current_balance) VALUES('card','manual','Synthetic card','credit',1000)").run();
 db.prepare("INSERT INTO debts(id,account_id,source,name,kind,balance,apr,min_payment) VALUES('debt','card','manual','Synthetic debt','credit',1000,12,100)").run();
 db.prepare("INSERT INTO income_sources(id,name,kind,monthly_amount,taxes_withheld) VALUES('income','Synthetic income','salary',4000,1)").run();
 const now=new Date();for(let i=1;i<=3;i++){
  const date=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,15)).toISOString().slice(0,10);
  db.prepare("INSERT INTO transactions(transaction_id,account_id,item_id,amount,date,name,category) VALUES(?,?,?,?,?,?,?)").run('spend'+i,'cash','manual',3000,date,'Synthetic living costs','FOOD_AND_DRINK');
 }
 [,plan]=await request('/api/advisor/debt-plan');assert.equal(plan.status,'ready');assert.equal(plan.extra_payment,900);assert.equal(plan.scenarios.length,2);
 db.prepare("UPDATE debts SET apr=NULL WHERE id='debt'").run();
 [,plan]=await request('/api/advisor/debt-plan');assert.equal(plan.status,'needs_data');assert.equal(plan.extra_payment,0);assert.equal(plan.scenarios.length,0);
 const start=await fetch(root+'/api/advisor/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const {jobId}=await start.json();
 await new Promise(r=>setTimeout(r,20));const result=await(await fetch(root+'/api/jobs/'+jobId)).json();assert.equal(result.status,'error');assert.match(result.error,/\$0/);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_reports').get().n,0);db.close();
 console.log(JSON.stringify({http_acceptance:'passed',synthetic_ready_plan:true,missing_apr_blocks_projection:true,free_plan_without_credits:true,paid_zero_budget_blocked:true,assumption_validation:'passed',model_reservations:0,production_volumes_used:false}));
})().catch(e=>{console.error(e.message);process.exit(1)});
