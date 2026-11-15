'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {fixture,login}=require('./helpers.cjs');

test('operator can make a consistent live backup and recover a lost administrator password',async()=>{
  const f=await fixture();
  try{
    const admin=path.resolve(__dirname,'..','admin.cjs'),backup=path.join(f.dir,'backup.sqlite');
    const env={...process.env,DATA_DIR:f.config.dataDir};
    execFileSync(process.execPath,[admin,'backup',backup],{env,stdio:'pipe'});
    const copy=new DatabaseSync(backup,{readOnly:true});
    assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.equal(copy.prepare('SELECT username FROM users').get().username,'admin');copy.close();
    const browser=await login(f);
    execFileSync(process.execPath,[admin,'reset-password','admin'],{env,input:'recovered-password-fixture\n',stdio:['pipe','pipe','pipe']});
    assert.equal((await f.request('/console/api/session',{headers:browser.headers})).body.authenticated,false);
    assert.ok((await login(f,'admin','recovered-password-fixture')).csrf);
    assert.ok(fs.statSync(backup).size>0);
  }finally{await f.close();}
});
