'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SyncClient}=require('../electron/sync.cjs');
function fixture(){
  const client=new SyncClient({list:()=>({Sessions:[],Folders:[],Credentials:[],Macros:[]}),
    replaceSynced:()=>{}});
  const records=[];
  client.request=async(method,resource,data)=>{
    records.push({method,resource,data});
    if(resource==='/v1/device/start')
      return {id:'a'.repeat(32),secret:'server-secret-should-not-leak-to-browser',code:'ABCD-EFGH',
        expiresIn:600,portalUrl:'https://sync.example.test:8443/console'};
    if(resource==='/v1/device/poll')
      return {status:'approved',token:'device-authorization-token',user:'testuser'};
    if(resource==='/v1/snapshot')
      return {revision:0,blob:null};
    throw Error('Unexpected route '+resource);
  };
  return {client,records};
}
test('device pairing uses only a URL and an out-of-band browser code',async()=>{
  const f=fixture();
  const pending=await f.client.pairStart({url:'https://sync.example.test:8443',label:'Test device'});
  assert.equal(pending.code,'ABCD-EFGH');
  assert.equal(pending.server,'https://sync.example.test:8443');
  assert.equal(f.client.status().pairingCode,'ABCD-EFGH');
  assert.equal(f.client.status().connected,false);
  assert.equal(pending.secret,undefined);
  assert.equal(f.records[0].data.label,'Test device');
  assert.ok(!JSON.stringify(pending).includes('server-secret'));
  const response=await f.client.pairPoll();
  assert.equal(response.status,'approved');
  assert.equal(f.client.status().connected,true);
  assert.equal(f.client.status().user,'testuser');
  assert.equal(f.client.status().encryptionReady,false);
  assert.equal(f.client.status().pairingCode,'');
  assert.equal(f.records[1].data.secret,'server-secret-should-not-leak-to-browser');
});
test('pairing refuses untrusted addresses and never contacts them',async()=>{
  const f=fixture();
  for(const url of ['http://sync.example.test:8443','https://user:secret@sync.example.test:8443',
                    'https://sync.example.test:8443/path','https://sync.example.test:8443/?token=bad']){
    await assert.rejects(f.client.pairStart({url}),/HTTPS/);
  }
  assert.equal(f.records.length,0);
});
test('browser authentication does not unlock encrypted profile data',async()=>{
  const f=fixture();
  await f.client.pairStart({url:'https://sync.example.test:8443'});
  await f.client.pairPoll();
  await assert.rejects(f.client.upload(),/Unlock encrypted profiles/);
  await assert.rejects(f.client.download(),/Unlock encrypted profiles/);
  await assert.rejects(f.client.unlockProfiles('short'),/at least 12/);
  const result=await f.client.unlockProfiles('a-correct-independent-recovery-secret');
  assert.equal(result.encryptionReady,true);
  assert.equal(result.autoReady,false);
  assert.equal(f.client.status().connected,true);
  assert.equal(f.records.some(r=>JSON.stringify(r.data||'').includes('a-correct-independent-recovery-secret')),false);
});
test('existing remote profile must be decrypted locally before any sync can start',async()=>{
  const f=fixture();
  const cryptoClient=new SyncClient({});
  cryptoClient.passphrase='correct-phrase-for-encrypted-snapshots';
  const blob=cryptoClient.encrypt({Sessions:[],Folders:[],Credentials:[],Macros:[],imported:true});
  const request=f.client.request;
  f.client.request=async(method,route,payload)=>{
    if(route==='/v1/snapshot')return {revision:5,blob};
    return request(method,route,payload);
  };
  await f.client.pairStart({url:'https://sync.example.test:8443'});
  await f.client.pairPoll();
  await assert.rejects(f.client.unlockProfiles('a-completely-wrong-recovery-passphrase'),/Unable to unlock/);
  assert.equal(f.client.status().encryptionReady,false);
  assert.equal(f.client.status().autoReady,false);
  const unlocked=await f.client.unlockProfiles('correct-phrase-for-encrypted-snapshots');
  assert.equal(unlocked.encryptionReady,true);
  assert.equal(unlocked.autoReady,false);
});

test('Vaultwarden status is harmless before login, but secret actions stay protected',async()=>{
  const f=fixture();
  const status=await f.client.vaultStatus();
  assert.equal(status.connected,false);
  assert.equal(status.configured,false);
  assert.equal(status.itemCount,0);
  assert.equal(status.account,'');
  assert.equal(status.server,'');
  assert.equal(f.records.length,0,'offline status must not contact server');
  await assert.rejects(f.client.vaultItems(),/Log in to Sync first/);
  await assert.rejects(f.client.vaultSync(),/Log in to Sync first/);
});
test('polling without a pending code is an idle state, not a rejected IPC call',async()=>{
  const f=fixture();
  assert.deepEqual(await f.client.pairPoll(),{status:'idle'});
  assert.equal(f.records.length,0);
  await f.client.pairStart({url:'https://sync.example.test:8443'});
  f.client.pairing.deadline=Date.now()-1;
  assert.deepEqual(await f.client.pairPoll(),{status:'expired'});
  assert.equal(f.client.status().pairingCode,'');
  assert.deepEqual(await f.client.pairPoll(),{status:'idle'});
});
test('simultaneous browser poll events consume only one token',async()=>{
  const f=fixture();
  await f.client.pairStart({url:'https://sync.example.test:8443'});
  let polls=0;
  const original=f.client.request;
  f.client.request=async(method,route,payload)=>{
    if(route==='/v1/device/poll'){
      polls++;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    return original(method,route,payload);
  };
  const [first,second,third]=await Promise.all([
    f.client.pairPoll(),f.client.pairPoll(),f.client.pairPoll()]);
  assert.equal(polls,1,'only one network poll may consume the one-time token');
  for(const reply of [first,second,third]){
    assert.equal(reply.status,'approved');
    assert.equal(reply.connected,true);
  }
  assert.equal((await f.client.pairPoll()).status,'approved');
  assert.equal(f.client.status().pairingCode,'');
});
test('cancelled pairing ignores an in-flight late approval',async()=>{
  const f=fixture();
  await f.client.pairStart({url:'https://sync.example.test:8443'});
  let release;
  f.client.request=async(method,route)=>{
    if(route==='/v1/device/poll')return new Promise(resolve=>release=resolve);
    return {revision:0,blob:null};
  };
  const request=f.client.pairPoll();
  await Promise.resolve();
  assert.equal(typeof release,'function');
  const status=f.client.cancelPairing();
  assert.equal(status.connected,false);
  assert.equal(status.pairingCode,'');
  release({status:'approved',token:'unwanted-token',user:'cancelled'});
  const result=await request;
  assert.equal(result.status,'idle');
  assert.equal(f.client.status().connected,false);
});
test('server expiry and metadata failures do not leave user trapped in pairing',async()=>{
  const f=fixture();
  await f.client.pairStart({url:'https://sync.example.test:8443'});
  const original=f.client.request;
  f.client.request=async(method,route,payload)=>{
    if(route==='/v1/device/poll')throw Error('Pairing request expired');
    return original(method,route,payload);
  };
  assert.deepEqual(await f.client.pairPoll(),{status:'expired'});
  assert.equal(f.client.status().pairingCode,'');
  await f.client.pairStart({url:'https://sync.example.test:8443'});
  f.client.request=async(method,route,payload)=>{
    if(route==='/v1/device/poll')
      return {status:'approved',token:'valid-token',user:'example'};
    if(route==='/v1/snapshot')throw Error('Temporary timeout');
    return original(method,route,payload);
  };
  const status=await f.client.pairPoll();
  assert.equal(status.status,'approved');
  assert.equal(status.connected,true);
  assert.match(status.autoError,/metadata/);
});
