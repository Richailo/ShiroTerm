'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Activity,MAX_RECORDS}=require('../electron/activity.cjs');

test('activity keeps only metadata and never captures raw SSH output or credentials',()=>{
  const history=new Activity();
  assert.equal(history.record({type:'data',sessionId:'a',
    data:'password=DO-NOT-LOG',password:'DO-NOT-LOG'}),false);
  history.record({type:'status',sessionId:'a',status:'shell-ready',
    data:'DO-NOT-LOG',password:'DO-NOT-LOG'},'Demo server');
  history.record({type:'verify',sessionId:'a',fingerprint:'secret-fingerprint',
    host:'server',changed:true},'Demo server');
  history.record({type:'error',sessionId:'a',message:'Timed out'},'Demo server');
  history.record({type:'error',sessionId:'b',message:'password=DO-NOT-LOG'},'Demo server');
  const rows=history.list();
  assert.equal(rows.length,4);
  assert.equal(rows[1].changed,true);
  assert.equal(rows[2].message,'Timed out');
  assert.equal(rows[3].message,'password=[REDACTED]');
  assert.equal(JSON.stringify(rows).includes('DO-NOT-LOG'),false);
  assert.equal(JSON.stringify(rows).includes('secret-fingerprint'),false);
  assert.equal(history.clear(),true);
  assert.equal(history.list().length,0);
});
test('activity has a bounded memory footprint and returns detached entries',()=>{
  const history=new Activity();
  for(let i=0;i<MAX_RECORDS+80;i++)
    history.record({type:'status',sessionId:String(i),status:'connected'},'Server');
  const first=history.list();
  assert.equal(first.length,MAX_RECORDS);
  assert.equal(first[0].sessionId,'80');
  first[0].host='MUTATED';
  assert.equal(history.list()[0].host,'Server');
});
