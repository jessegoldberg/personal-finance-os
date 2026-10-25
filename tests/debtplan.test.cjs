const test=require('node:test');const assert=require('node:assert/strict');
const {debtActionPlan,project}=require('../backend/dist/debtplan');
const base=()=>({date:'2026-10-24',income:4000,incomeSource:'entered',spending:3000,planned:200,cash:4000,historyMonths:3,
 debts:[{id:'card',name:'Test card',balance:1000,apr:12,min_payment:100}]});
test('zero-interest payoff, paid-in-full and month rollover have independent known answers',()=>{
 const d=[{id:'a',name:'A',balance:1000,apr:0,min_payment:100}];
 assert.equal(project(d,0,'avalanche','2026-10-24').months,10);
 assert.equal(project(d,0,'avalanche','2026-10-24').debt_free_month,'2027-08');
 assert.equal(project(d,0,'avalanche','2026-10-24').total_interest,0);
 assert.equal(project([{...d[0],balance:100,apr:12,min_payment:101}],0,'avalanche','2026-10-24').total_interest,1);
});
test('avalanche saves interest while all minimums remain covered',()=>{
 const debts=[{id:'a',name:'A',balance:5000,apr:25,min_payment:120},{id:'b',name:'B',balance:800,apr:5,min_payment:30}];
 const a=project(debts,200,'avalanche','2026-10-24'),s=project(debts,200,'snowball','2026-10-24');
 assert.ok(a.total_interest<s.total_interest);assert.equal(a.monthly_payment,350);
});
test('cashflow includes home minimums but projections exclude home debt',()=>{
 const b=base();b.debts.push({id:'home',name:'Mortgage',balance:150000,apr:null,min_payment:600,home_secured:true});
 const p=debtActionPlan(b);assert.equal(p.minimum_payments,700);assert.equal(p.extra_payment,100);
 assert.equal(p.consumer_balance,1000);assert.equal(p.priorities.length,1);assert.equal(p.status,'ready');
});
test('unknown APR or minimum never generates a payoff date or extra-payment instruction',()=>{
 for (const patch of [{apr:null},{min_payment:null},{min_payment:0},{is_overdue:1},{promo_end_date:'2027-01-01'}]){
  const b=base();Object.assign(b.debts[0],patch);const p=debtActionPlan(b);
  assert.equal(p.status,'needs_data');assert.equal(p.extra_payment,0);assert.deepEqual(p.scenarios,[]);
 }
});
test('detected income, thin spending or unbudgeted events require confirmation',()=>{
 for(const change of [{incomeSource:'detected'},{income:0},{historyMonths:2},{spending:0},{unbudgetedEvents:['Trip']},{staleAccounts:['Old card']}]){
  const p=debtActionPlan({...base(),...change});assert.equal(p.extra_payment,0);assert.ok(p.missing_data.length);
 }
});
test('reserve rebuild and overdraft reduce affordable extra; cash is not a lump sum',()=>{
 const b=base();b.cash=2900;let p=debtActionPlan(b);assert.equal(p.reserve_contribution,100);assert.equal(p.extra_payment,600);
 b.cash=-100;p=debtActionPlan(b);assert.equal(p.reserve_gap,3100);assert.equal(p.extra_payment,0);
 b.cash=100000;p=debtActionPlan(b);assert.equal(p.extra_payment,700);
});
test('cash shortfall does not produce a fantasy accelerated strategy',()=>{
 const p=debtActionPlan({...base(),income:3000});assert.equal(p.monthly_shortfall,300);assert.equal(p.status,'cashflow_shortfall');
 assert.equal(p.extra_payment,0);assert.deepEqual(p.scenarios,[]);
});
test('nonamortizing budgets and no consumer debt do not fabricate dates',()=>{
 assert.equal(project([{id:'x',name:'X',balance:1000,apr:60,min_payment:1}],0,'avalanche','2026-10-24').months,null);
 const b=base();b.debts[0].home_secured=true;assert.equal(debtActionPlan(b).status,'no_consumer_debt');
});
test('invalid amounts and unverified direct projections fail closed',()=>{
 for(const change of [{income:NaN},{spending:-1},{cash:Infinity}])assert.throws(()=>debtActionPlan({...base(),...change}));
 assert.throws(()=>project([{...base().debts[0],apr:null}],100,'avalanche','2026-10-24'));
});

test('tax coverage must be confirmed and additional reserves reduce capacity exactly once',()=>{
 const b=base();b.untaxedIncome=500;let p=debtActionPlan(b);assert.equal(p.status,'needs_data');assert.equal(p.extra_payment,0);
 b.taxReserve=125;p=debtActionPlan(b);assert.equal(p.extra_payment,575);
 b.taxReserve=0;b.cashBufferTarget=4500;p=debtActionPlan(b);assert.equal(p.reserve_contribution,500);assert.equal(p.extra_payment,200);
});
