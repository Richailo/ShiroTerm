'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {fixture,login}=require('./helpers.cjs');
const {SyncClient}=require('../../electron/sync.cjs');

test('real desktop client pairs over verified HTTPS, remembers login, merges changes and restores history',async()=>{
  const certDir=fs.mkdtempSync(path.join(os.tmpdir(),'shiroterm-tls-test-'));
  const keyPath=path.join(certDir,'key.pem'),certPath=path.join(certDir,'cert.pem');
  const openssl=process.platform==='win32'&&fs.existsSync('C:\\Program Files\\Git\\usr\\bin\\openssl.exe')?
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe':'openssl';
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','2',
    '-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-keyout',keyPath,'-out',certPath],{stdio:'pipe',env:{...process.env,MSYS_NO_PATHCONV:'1'}});
  const previousCA=process.env.SHIROTERM_SYNC_CA;
  process.env.SHIROTERM_SYNC_CA=certPath;
  let f;
  try{
    f=await fixture({service:{tls:{key:fs.readFileSync(keyPath),cert:fs.readFileSync(certPath)}}});
    const browser=await login(f);
    const stores=[];
    function store(name){
      const key=crypto.randomBytes(32),dir=path.join(f.dir,name);
      fs.mkdirSync(dir);
      const data={Sessions:[{Id:'web',Name:'Web server',Host:'192.0.2.10',Protocol:'SSH',User:'demo',
        KeyFile:'/private/local-only.key',HasStoredPassword:true}],Folders:[],Credentials:[],Macros:[]};
      const target={dir,data,list:()=>structuredClone(target.data),replaceSynced:value=>{target.data=structuredClone(value);},
        safeStorage:{isEncryptionAvailable:()=>true,encryptString(value){
          const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
          const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
          return Buffer.concat([iv,cipher.getAuthTag(),body]);
        },decryptString(buffer){
          const cipher=crypto.createDecipheriv('aes-256-gcm',key,buffer.subarray(0,12));
          cipher.setAuthTag(buffer.subarray(12,28));
          return Buffer.concat([cipher.update(buffer.subarray(28)),cipher.final()]).toString('utf8');
        }}};
      stores.push(target);return target;
    }
    async function pair(client){
      const pending=await client.pairStart({url:f.base,label:'Desktop integration fixture'});
      const approved=await f.request('/console/api/device/approve',{headers:browser.headers,body:{code:pending.code}});
      assert.equal(approved.status,200);
      assert.equal((await client.pairPoll()).status,'approved');
    }
    const firstStore=store('first'),first=new SyncClient(firstStore);
    await pair(first);assert.equal(first.status().remembered,true);
    first.passphrase='fixture-independent-recovery-passphrase';
    await first.upload();assert.equal(first.revision,1);
    const remote=f.service.db.snapshot('admin','personal');
    assert.ok(!JSON.stringify(remote.blob).includes('Web server'));
    assert.equal(first.snapshot().Sessions[0].KeyFile,undefined);
    const resumed=new SyncClient(firstStore);
    assert.equal(await resumed.restoreSession(),true);
    assert.equal(resumed.status().connected,true);assert.equal(resumed.passphrase,'');
    assert.equal(resumed.status().revision,1);
    const secondStore=store('second'),second=new SyncClient(secondStore);
    await pair(second);await second.unlockProfiles(first.passphrase);await second.download();
    first.setAuto(true);second.setAuto(true);
    firstStore.data.Sessions[0].Name='Updated web server';
    secondStore.data.Sessions.push({Id:'db',Name:'Database',Host:'192.0.2.20'});
    await first.autoTick();const merged=await second.autoTick();
    assert.equal(merged.autoState,'idle');assert.equal(merged.changedLocal,true);
    assert.deepEqual(secondStore.data.Sessions.map(h=>h.Name),['Updated web server','Database']);
    await first.autoTick();
    firstStore.data.Sessions[0].Name='First concurrent edit';
    secondStore.data.Sessions[0].Name='Second concurrent edit';
    await first.autoTick();const conflict=await second.autoTick();
    assert.equal(conflict.autoState,'conflict');assert.equal(conflict.autoConflicts.length,1);
    const before=f.service.db.snapshot('admin','personal').revision;
    await second.resolveKeepLocal();assert.equal(second.revision,before+1);
    assert.ok((await second.history()).length>0);
    // The configured history retention is three versions; restore a retained one.
    const retained=(await second.history()).at(-1).revision;
    const restored=await second.restoreVersion(retained);
    assert.equal(restored.revision,before+2);
    const rememberedToken=resumed.token;
    await resumed.signOut();
    assert.equal(fs.existsSync(resumed.sessionFile),false);
    const unauthorized=await f.request('/v1/snapshot',{headers:{Authorization:'Bearer '+rememberedToken}});
    assert.equal(unauthorized.status,401);
  }finally{
    if(previousCA===undefined)delete process.env.SHIROTERM_SYNC_CA;else process.env.SHIROTERM_SYNC_CA=previousCA;
    if(f)await f.close();fs.rmSync(certDir,{recursive:true,force:true});
  }
});
