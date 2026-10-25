const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
let Database;try{Database=require('node:sqlite').DatabaseSync;}catch{Database=require('../backend/node_modules/better-sqlite3');}
const {debtActionPlan}=require('../backend/dist/debtplan');const {requestReservation}=require('../backend/dist/paid-policy');
const db=new Database(':memory:');db.exec(fs.readFileSync(path.join(__dirname,'../backend/db/schema.sql'),'utf8'));
const getSetting=key=>db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value??null;
const setSetting=(key,value)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
let snapshot=debtActionPlan({date:'2026-10-24',income:4000,incomeSource:'entered',spending:3000,planned:200,cash:4000,historyMonths:3,
 debts:[{id:'test',name:'Synthetic card',balance:1000,apr:12,min_payment:100}]});
let calls=0,corrupt=false;
require.cache[require.resolve('../backend/dist/db')]={exports:{db,getSetting,setSetting}};
require.cache[require.resolve('../backend/dist/debtplan-data')]={exports:{currentDebtPlan:()=>snapshot}};
require.cache[require.resolve('../backend/dist/ai')]={exports:{MODEL:'claude-opus-5-5',requireKey:()=>{},compactJson:JSON.stringify,
 paidMessage:async(feature,params)=>{calls++;assert.ok(requestReservation(params)>0);
  const report={headline:'Synthetic draft',health_score:null,summary:'Test only',monthly_surplus_estimate:snapshot.monthly_surplus,
   recommended_extra_payment:corrupt?999999:snapshot.extra_payment,monthly_set_aside_for_life_events:snapshot.planned_expenses,
   strategy:{method:'avalanche',rationale:'Synthetic',debt_free_date:snapshot.scenarios[0].debt_free_month,interest_saved_vs_minimums:0},
   action_plan:[],spending_cuts:[],budget_suggestions:[],home_options:[],warnings:[],missing_data:[]};
  return {stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(report)}]};}}};
const {generateReport}=require('../backend/dist/advisor');
test('bounded decision brief is reused without another paid call when unchanged',async()=>{
 await generateReport();assert.equal(calls,1);await generateReport();assert.equal(calls,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_reports').get().n,1);
});
test('AI numeric contradiction is rejected and not stored',async()=>{
 snapshot={...snapshot,extra_payment:snapshot.extra_payment+1};corrupt=true;
 await assert.rejects(generateReport,/contradicted/);assert.equal(calls,2);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_reports').get().n,1);
});
test('missing planning data blocks the paid plan before inference',async()=>{
 snapshot={...snapshot,status:'needs_data'};const before=calls;
 await assert.rejects(generateReport,/data checks/);assert.equal(calls,before);db.close();
});
