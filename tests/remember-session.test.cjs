'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {SyncClient}=require('../electron/sync.cjs');
function setup(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shiro-remember-'));
  const key=crypto.randomBytes(32);
  const safeStorage={
    isEncryptionAvailable:()=>true,
    encryptString(value){
      const iv=crypto.randomBytes(12);
      const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
      const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
      return Buffer.concat([iv,cipher.getAuthTag(),encrypted]);
    },
    decryptString(value){
      const decipher=crypto.createDecipheriv('aes-256-gcm',key,value.subarray(0,12));
      decipher.setAuthTag(value.subarray(12,28));
      return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8');
    }
  };
  const store={dir,safeStorage,
    list:()=>({Sessions:[],Folders:[],Credentials:[],Macros:[]}),
    replaceSynced:()=>{}};
  const session=()=>new SyncClient(store);
  return {session,dir,safeStorage,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
async function paired(client,expires=Math.floor(Date.now()/1000)+30*86400){
  client.request=async(method,uri)=>{
    if(uri==='/v1/device/start')
      return {id:'b'.repeat(32),secret:'test-secret',code:'ABCD-ABCD',expiresIn:600};
    if(uri==='/v1/device/poll')
      return {status:'approved',user:'testuser',token:'r'.repeat(64),expires};
    if(uri==='/v1/snapshot')return {revision:3,blob:null};
    if(uri==='/v1/auth/logout')return {ok:true};
    throw Error('Unexpected '+uri);
  };
  await client.pairStart({url:'https://sync.example.test:8443'});
  await client.pairPoll();
}
test('browser paired device resumes from encrypted Windows session storage',async()=>{
  const f=setup();
  try{
    const first=f.session();await paired(first);
    assert.equal(first.status().remembered,true);
    assert.ok(fs.existsSync(first.sessionFile));
    assert.ok(!fs.readFileSync(first.sessionFile).toString().includes('r'.repeat(64)));
    const second=f.session();
    second.request=async(method,uri)=>{
      assert.equal(second.token,'r'.repeat(64));
      assert.equal(uri,'/v1/snapshot');
      return {revision:3,blob:null};
    };
    assert.equal(await second.restoreSession(),true);
    assert.equal(second.status().connected,true);
    assert.equal(second.status().user,'testuser');
    assert.equal(second.status().revision,3);
    assert.equal(second.status().encryptionReady,false);
    assert.equal(second.status().autoEnabled,false);
  }finally{f.cleanup();}
});
test('signing out deletes remembered device token, even when server is offline',async()=>{
  const f=setup();
  try{
    const client=f.session();await paired(client);
    client.request=async()=>{throw Error('network is offline');};
    await assert.rejects(client.signOut(),/revocation could not be confirmed/);
    assert.equal(fs.existsSync(client.sessionFile),false);
    const reopened=f.session();
    assert.equal(await reopened.restoreSession(),false);
    assert.equal(reopened.status().connected,false);
  }finally{f.cleanup();}
});
test('revoked server token is discarded and does not reconnect',async()=>{
  const f=setup();
  try{
    await paired(f.session());
    const again=f.session();
    again.request=async()=>{throw Error('Unauthorized');};
    assert.equal(await again.restoreSession(),false);
    assert.equal(again.status().connected,false);
    assert.equal(fs.existsSync(again.sessionFile),false);
  }finally{f.cleanup();}
});
test('a temporary network outage keeps encrypted session for retry',async()=>{
  const f=setup();
  try{
    await paired(f.session());
    const again=f.session();
    again.request=async()=>{throw Error('Sync server timed out');};
    assert.equal(await again.restoreSession(),false);
    assert.equal(fs.existsSync(again.sessionFile),true);
    again.request=async()=>({revision:7,blob:null});
    assert.equal(await again.restoreSession(),true);
    assert.equal(again.status().revision,7);
  }finally{f.cleanup();}
});
test('expired, corrupted or unavailable Windows protection never logs in',async()=>{
  const f=setup();
  try{
    await paired(f.session(),Math.floor(Date.now()/1000)-30);
    const expired=f.session();
    assert.equal(await expired.restoreSession(),false);
    assert.equal(fs.existsSync(expired.sessionFile),false);
    await paired(f.session());
    fs.writeFileSync(path.join(f.dir,'server-device-session.bin'),'invalid ciphertext');
    assert.equal(await f.session().restoreSession(),false);
    assert.equal(fs.existsSync(path.join(f.dir,'server-device-session.bin')),false);
    const insecure=f.session();
    f.safeStorage.isEncryptionAvailable=()=>false;
    await paired(insecure);
    assert.equal(insecure.status().remembered,false);
    assert.equal(fs.existsSync(insecure.sessionFile),false);
  }finally{f.cleanup();}
});


test('last selected vault is restored only after the server confirms ownership',async()=>{
  const f=setup();
  const vaultId='d'.repeat(32);
  try{
    const store=f.session().store;
    store.activeVaultId='personal';
    store.activateVault=id=>{store.activeVaultId=id;};
    const first=f.session();
    await paired(first);
    first.request=async(method,uri)=>{
      if(uri==='/v1/profile-vaults')
        return {vaults:[{id:'personal',name:'Personal'},
          {id:vaultId,name:'Infrastructure'}]};
      if(uri==='/v1/profile-vaults/'+vaultId+'/snapshot')
        return {revision:4,blob:null};
      throw Error('Unexpected '+uri);
    };
    await first.selectProfileVault(vaultId);
    assert.equal(first.status().vaultName,'Infrastructure');
    const second=f.session();
    let restoredEvent=null;
    second.onRestored=state=>restoredEvent=state;
    second.request=first.request;
    assert.equal(await second.restoreSession(),true);
    assert.equal(second.status().vaultId,vaultId);
    assert.equal(second.status().vaultName,'Infrastructure');
    assert.equal(store.activeVaultId,vaultId);
    assert.equal(second.status().revision,4);
    assert.equal(restoredEvent.vaultId,vaultId);
    assert.equal(second.status().encryptionReady,false);
  }finally{f.cleanup();}
});
test('revoked vault membership falls back to Personal, without removing account login',async()=>{
  const f=setup();
  const vaultId='e'.repeat(32);
  try{
    const store=f.session().store;
    store.activeVaultId='personal';
    store.activateVault=id=>{store.activeVaultId=id;};
    const first=f.session();await paired(first);
    first.request=async(_method,uri)=>{
      if(uri==='/v1/profile-vaults')
        return {vaults:[{id:'personal',name:'Personal'},{id:vaultId,name:'Old vault'}]};
      if(uri==='/v1/profile-vaults/'+vaultId+'/snapshot')return {revision:3,blob:null};
      throw Error('Unexpected '+uri);
    };
    await first.selectProfileVault(vaultId);
    const second=f.session();
    second.request=async(_method,uri)=>{
      if(uri==='/v1/profile-vaults')return {vaults:[{id:'personal',name:'Personal'}]};
      if(uri==='/v1/snapshot')return {revision:1,blob:null};
      throw Error('Unexpected '+uri);
    };
    assert.equal(await second.restoreSession(),true);
    assert.equal(second.status().connected,true);
    assert.equal(second.status().vaultId,'personal');
    assert.equal(second.status().revision,1);
    assert.equal(store.activeVaultId,'personal');
    const third=f.session();third.request=second.request;
    assert.equal(await third.restoreSession(),true);
    assert.equal(third.status().vaultId,'personal');
  }finally{f.cleanup();}
});
test('offline vault restoration never switches local profiles or erases encrypted login',async()=>{
  const f=setup();
  const vaultId='f'.repeat(32);
  try{
    const store=f.session().store;
    store.activeVaultId='personal';
    store.activateVault=id=>{store.activeVaultId=id;};
    const first=f.session();await paired(first);
    first.request=async(_method,uri)=>{
      if(uri==='/v1/profile-vaults')
        return {vaults:[{id:'personal'},{id:vaultId,name:'Offline vault'}]};
      if(uri==='/v1/profile-vaults/'+vaultId+'/snapshot')
        return {revision:8,blob:null};
    };
    await first.selectProfileVault(vaultId);
    // Simulate a fresh Electron process: Store always loads Personal first.
    store.activateVault('personal');
    const restarted=f.session();
    restarted.request=async()=>{throw Error('Network offline');};
    assert.equal(await restarted.restoreSession(),false);
    assert.equal(store.activeVaultId,'personal');
    assert.equal(restarted.status().connected,false);
    assert.equal(fs.existsSync(restarted.sessionFile),true);
  }finally{f.cleanup();}
});


test('restoring device remains disconnected until server verifies token',async()=>{
  const f=setup();
  try{
    await paired(f.session());
    const client=f.session();
    let finish;
    client.request=()=>new Promise(resolve=>{finish=resolve;});
    const pending=client.restoreSession();
    assert.equal(client.status().connected,false);
    assert.equal(typeof finish,'function');
    finish({revision:2,blob:null});
    assert.equal(await pending,true);
    assert.equal(client.status().connected,true);
    assert.equal(client.status().revision,2);
  }finally{f.cleanup();}
});
