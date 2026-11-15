'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mergeProfiles}=require('../electron/sync-merge.cjs');
const {SyncClient}=require('../electron/sync.cjs');
const clone=value=>structuredClone(value);
function data(){
  return {Sessions:[{Id:'a',Name:'Router',Host:'a.internal'},{Id:'b',Name:'Node',Host:'b.internal'}],
    Folders:[],Credentials:[{Id:'cred1',Name:'admin',VaultItemId:'fake-uuid'}],
    Macros:[],ThemePreferences:null,imported:true};
}
function fixture(){
  const base=data();let local=clone(base),remote=clone(base),revision=1;
  let writes=0,replaces=0;
  const store={list:()=>clone(local),replaceSynced:next=>{local=clone(next);replaces++;}};
  const client=new SyncClient(store);
  client.user='tester';client.token='fake';client.passphrase='test-passphrase-for-encryption';
  client.revision=1;client.remoteExists=true;client.baseline=clone(base);client.autoEnabled=true;
  client.request=async(method,uri,body)=>{
    if(method==='GET')return {revision,blob:client.encrypt(remote)};
    if(method==='PUT'){
      if(body.expected_revision!==revision)throw Error('Revision conflict');
      remote=client.decrypt(body.blob);revision++;writes++;
      return {revision};
    }
    throw Error('Unexpected API request');
  };
  return {client,get local(){return local},set local(value){local=value},
    get remote(){return remote},set remote(value){remote=value},
    get writes(){return writes},get replaces(){return replaces}};
}
test('merges edits to two different host records and keeps Vaultwarden reference',async()=>{
  const f=fixture();
  f.local.Sessions[0].Name='Router local';
  f.remote.Sessions[1].Name='Node remote';
  const result=await f.client.autoTick();
  assert.equal(result.autoState,'idle');assert.equal(result.changedLocal,true);
  assert.equal(f.remote.Sessions[0].Name,'Router local');
  assert.equal(f.local.Sessions[1].Name,'Node remote');
  assert.equal(f.writes,1);assert.equal(f.replaces,1);
  assert.equal(f.remote.Credentials[0].VaultItemId,'fake-uuid');
});
test('refuses concurrent edits to same entry and changes neither copy',async()=>{
  const f=fixture();
  f.local.Sessions[0].Name='local edit';
  f.remote.Sessions[0].Name='remote edit';
  const r=await f.client.autoTick();
  assert.equal(r.autoState,'conflict');
  assert.equal(r.autoConflicts.length,1);
  assert.equal(f.writes,0);assert.equal(f.replaces,0);
  assert.equal(f.local.Sessions[0].Name,'local edit');
  assert.equal(f.remote.Sessions[0].Name,'remote edit');
});
test('remote-only change is pulled without overwriting local secrets',async()=>{
  const f=fixture();
  f.remote.Folders.push({Id:'folder1',Name:'Other device',ParentId:''});
  const r=await f.client.autoTick();
  assert.equal(r.changedLocal,true);assert.equal(f.writes,0);
  assert.equal(f.local.Folders[0].Name,'Other device');
});
test('local-only change pushes without changing local data',async()=>{
  const f=fixture();f.local.Macros.push({Id:'script1',Name:'Ping',Command:'ping'});
  const r=await f.client.autoTick();
  assert.equal(r.changedLocal,false);assert.equal(f.replaces,0);
  assert.equal(f.writes,1);assert.equal(f.remote.Macros[0].Name,'Ping');
});
test('delete-versus-edit is a conflict',()=>{
  const b=data(),l=clone(b),r=clone(b);
  l.Sessions.shift();r.Sessions[0].Name='new remote name';
  const merged=mergeProfiles(b,l,r);
  assert.equal(merged.conflicts.length,1);
  assert.equal(merged.conflicts[0].section,'Sessions');
});
test('deletes on one device propagate when the other has not changed',()=>{
  const b=data(),l=clone(b),r=clone(b);
  l.Credentials=[];
  const outcome=mergeProfiles(b,l,r);
  assert.deepEqual(outcome.conflicts,[]);
  assert.deepEqual(outcome.merged.Credentials,[]);
});
test('unchanged remote and local does not cause redundant encryption upload',async()=>{
  const f=fixture();
  const r=await f.client.autoTick();
  assert.equal(r.autoState,'idle');assert.equal(f.writes,0);assert.equal(f.replaces,0);
});
test('auto-sync cannot be enabled before a deliberate baseline',()=>{
  const c=new SyncClient({});
  c.token='fake';c.passphrase='phrase';
  assert.throws(()=>c.setAuto(true),/First download or upload/);
});
test('stale conflict resolution never overwrites newer server data',async()=>{
  const f=fixture();
  f.client.autoState='conflict';
  f.client.autoConflicts=[{section:'Sessions',id:'a',name:'Router'}];
  f.client.lastConflictRevision=0;
  await assert.rejects(f.client.resolveKeepLocal(),/changed again/);
  assert.equal(f.writes,0);
});
test('explicit conflict resolution can keep local changes',async()=>{
  const f=fixture();
  f.client.autoState='conflict';
  f.client.autoConflicts=[{section:'Sessions',id:'a',name:'Router'}];
  f.client.lastConflictRevision=1;
  f.local.Sessions[0].Name='current device';
  await f.client.resolveKeepLocal();
  assert.equal(f.writes,1);
  assert.equal(f.remote.Sessions[0].Name,'current device');
  assert.equal(f.client.status().autoConflicts.length,0);
});

test('restoring a historical encrypted snapshot creates a new version and updates local',async()=>{
  const client=new SyncClient({list:()=>data(),replaceSynced(value){this.last=value;}});
  client.token='test';client.passphrase='test-passphrase-for-encryption';client.revision=7;
  const previous=data();previous.Sessions[0].Name='historic version';
  const envelope=client.encrypt(previous),currentEnvelope=client.encrypt(data());
  const calls=[];
  client.request=async(method,route,payload)=>{
    calls.push([method,route]);
    if(route==='/v1/history/3')return {revision:3,blob:envelope};
    if(method==='GET')return {revision:7,blob:currentEnvelope};
    if(method==='PUT'){
      assert.equal(payload.expected_revision,7);
      assert.deepEqual(payload.blob,envelope);
      return {revision:8};
    }
    throw Error('Unexpected request');
  };
  const result=await client.restoreVersion(3);
  assert.equal(result.revision,8);
  assert.equal(client.baseline.Sessions[0].Name,'historic version');
  assert.equal(client.store.last.Sessions[0].Name,'historic version');
  assert.deepEqual(calls,[['GET','/v1/history/3'],['GET','/v1/snapshot'],['PUT','/v1/snapshot']]);
});
test('historical restore rejects malformed or unauthenticated data before any write',async()=>{
  const client=new SyncClient({replaceSynced:()=>{}});
  client.token='test';client.passphrase='different-passphrase-but-strong';client.revision=5;
  const another=new SyncClient({});
  another.passphrase='incompatible-strong-passphrase';
  const historyBlob=another.encrypt(data());
  client.request=async(method,uri)=>{
    if(method==='PUT')throw Error('must not overwrite!');
    if(uri.startsWith('/v1/history/'))return {blob:historyBlob};
    return {revision:5,blob:historyBlob};
  };
  await assert.rejects(client.restoreVersion(1),/Cannot decrypt/);
});
