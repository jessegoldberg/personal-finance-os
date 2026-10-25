const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
let Database;try{Database=require('node:sqlite').DatabaseSync;}catch{Database=require('../backend/node_modules/better-sqlite3');}
const {monthlyBudget,requestReservation}=require('../backend/dist/paid-policy');
const {initLedger,reserve,reserved}=require('../backend/dist/budget-ledger');
const params=()=>({model:'claude-opus-5-5',max_tokens:1024,messages:[{role:'user',content:'Synthetic budget test'}]});
test('zero or malformed budget fails closed',()=>{
 for(const raw of [undefined,'','-1','NaN','Infinity','1.234','$5','1001'])assert.equal(monthlyBudget(raw),0);
 assert.equal(monthlyBudget('5.25'),5250000);
});
test('output, input, tools, model swaps and fallback cannot bypass reservation bounds',()=>{
 const p=params();assert.ok(requestReservation(p)>20480);
 for(const patch of [{max_tokens:4097},{max_tokens:-1},{max_tokens:1.5},{model:'other'},
  {tools:[{name:'web_search'}]},{fallbacks:'default'},{betas:['fallback']},{messages:[{role:'user',content:'x'.repeat(12001)}]}])
  assert.throws(()=>requestReservation({...p,...patch}));
});
test('two independent connections cannot spend the same allowance; pending errors persist on reopen',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pfo-budget-'));const file=path.join(dir,'test.sqlite');
 let a=new Database(file),b=new Database(file);initLedger(a);
 const amount=requestReservation(params()),cap=amount*2;
 reserve(a,'2026-10',cap,'test',amount);reserve(b,'2026-10',cap,'test',amount);
 assert.throws(()=>reserve(a,'2026-10',cap,'test',1));assert.equal(reserved(b,'2026-10'),cap);
 a.close();b.close();a=new Database(file);initLedger(a);assert.equal(reserved(a,'2026-10'),cap);
 assert.throws(()=>reserve(a,'2026-10',0,'test',1));assert.equal(reserved(a,'2026-11'),0);
 a.close();fs.rmSync(dir,{recursive:true});
});
test('provider wrapper sends nothing at zero budget and does not retry a 503',async()=>{
 const http=require('node:http');let calls=0;let fail=false;
 const server=http.createServer((req,res)=>{calls++;req.resume();res.setHeader('Content-Type','application/json');
  if(fail){res.writeHead(503);res.end(JSON.stringify({type:'error',error:{type:'overloaded_error',message:'synthetic'}}));}
  else {
   res.setHeader('Content-Type','text/event-stream');
   const events=[
    {type:'message_start',message:{id:'test',type:'message',role:'assistant',model:'claude-opus-5-5',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
    {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Synthetic response'}},
    {type:'content_block_stop',index:0},
    {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:5}},
    {type:'message_stop'}];
   res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  }});

 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 process.env.ANTHROPIC_API_KEY='synthetic-not-a-real-key';process.env.ANTHROPIC_BASE_URL=`http://127.0.0.1:${server.address().port}`;
 process.env.PAID_AI_MONTHLY_BUDGET_USD='0';
 const db=new Database(':memory:');db.exec(fs.readFileSync(path.join(__dirname,'../backend/db/schema.sql'),'utf8'));
 const id=require.resolve('../backend/dist/db');require.cache[id]={exports:{db}};
 try{
  const {paidMessage,webResearch}=require('../backend/dist/ai');
  await assert.rejects(()=>paidMessage('test',params()));assert.equal(calls,0);
  process.env.PAID_AI_MONTHLY_BUDGET_USD='1';
  await assert.rejects(()=>webResearch('test','synthetic','synthetic'));assert.equal(calls,0);
  await paidMessage('test',params());assert.equal(calls,1);
  const before=reserved(db,new Date().toISOString().slice(0,7));fail=true;
  await assert.rejects(()=>paidMessage('test',params()));assert.equal(calls,2);
  assert.ok(reserved(db,new Date().toISOString().slice(0,7))>before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE state='unknown'").get().n,1);
 }finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));db.close();}
});
