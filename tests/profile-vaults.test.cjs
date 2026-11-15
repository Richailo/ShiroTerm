'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../electron/storage.cjs');
const {SyncClient}=require('../electron/sync.cjs');
const uuid='a'.repeat(32);
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shiro-vaults-'));
  const safeStorage={isEncryptionAvailable:()=>true,
    encryptString:()=>Buffer.from('encrypted'),
    decryptString:()=>''};
  const previousLocalAppData=process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA=dir;
  let store;
  try{store=new Store(dir,safeStorage);}
  finally{if(previousLocalAppData===undefined)delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA=previousLocalAppData;}
  const client=new SyncClient(store);
  client.token='fixture-token';client.user='fixture';
  let remoteRevision=0;
  client.request=async(method,uri,data)=>{
    if(method==='GET' && uri==='/v1/profile-vaults')
      return {vaults:[{id:'personal',name:'Personal',revision:0},
                      {id:uuid,name:'Homelab',revision:0}]};
    if(method==='GET' && uri.endsWith('/snapshot'))return {revision:remoteRevision,blob:null};
    if(method==='GET' && uri==='/v1/snapshot')return {revision:0,blob:null};
    if(method==='GET' && uri.endsWith('/history'))return {versions:[]};
    if(method==='PUT' && uri.endsWith('/snapshot')){
      remoteRevision+=1;return {revision:remoteRevision};
    }
    if(method==='POST' && uri==='/v1/profile-vaults'){
      return {id:uuid,name:data.name,kind:'private',revision:0};
    }
    throw Error('Unexpected '+method+' '+uri);
  };
  return {store,client,dir,clean:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('vault switch uses a physically separate local host file and preserves Personal',async()=>{
  const f=fixture();
  try{
    f.store.saveHost({Host:'personal.local',Name:'Personal host'});
    assert.equal(f.store.list().Sessions.length,1);
    await f.client.selectProfileVault(uuid);
    assert.equal(f.store.list().Sessions.length,0);
    assert.equal(f.client.status().vaultName,'Homelab');
    f.store.saveHost({Host:'homelab.local',Name:'Homelab host'});
    assert.equal(f.store.list().Sessions.length,1);
    assert.equal(fs.existsSync(path.join(f.dir,'profiles-vault-'+uuid+'.json')),true);
    await f.client.selectProfileVault('personal');
    assert.equal(f.store.list().Sessions.length,1);
    assert.equal(f.store.list().Sessions[0].Host,'personal.local');
    await f.client.selectProfileVault(uuid);
    assert.equal(f.store.list().Sessions[0].Host,'homelab.local');
  }finally{f.clean();}
});
test('selected vault resets encryption state and auto-sync so no cross-vault writes',async()=>{
  const f=fixture();
  try{
    f.client.passphrase='passphrase-used-by-personal';
    f.client.baseline={Sessions:[],Folders:[],Credentials:[],Macros:[]};
    f.client.autoEnabled=true;
    const result=await f.client.selectProfileVault(uuid);
    assert.equal(result.autoEnabled,false);
    assert.equal(result.encryptionReady,false);
    assert.equal(result.autoReady,false);
    assert.equal(f.client.snapshotPath,'/v1/profile-vaults/'+uuid+'/snapshot');
    assert.equal(f.client.historyPath,'/v1/profile-vaults/'+uuid+'/history');
    await assert.rejects(f.client.upload(),/Unlock encrypted profiles/);
  }finally{f.clean();}
});
test('cannot select unauthorized vault nor traverse local directories',async()=>{
  const f=fixture();
  try{
    await assert.rejects(f.client.selectProfileVault('../secrets'),/Invalid vault/);
    await assert.rejects(f.client.selectProfileVault('f'.repeat(32)),/not found/);
    assert.throws(()=>f.store.activateVault('..\\hack'),/Invalid profile vault/);
    assert.equal(f.store.activeVaultId,'personal');
    assert.equal(f.client.status().vaultId,'personal');
  }finally{f.clean();}
});
test('new vault list and server creation work without decrypted data',async()=>{
  const f=fixture();
  try{
    assert.equal((await f.client.listProfileVaults()).length,2);
    const created=await f.client.createProfileVault('School infrastructure');
    assert.equal(created.name,'School infrastructure');
  }finally{f.clean();}
});
