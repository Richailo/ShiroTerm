'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SyncClient}=require('../electron/sync.cjs');
test('client encryption uses a separate passphrase and detects tampering',()=>{
  const one=new SyncClient({list:()=>({}),replaceSynced:()=>{}});
  one.passphrase='standalone-strong-private-phrase-2026';
  const input={Sessions:[{Id:'a',Name:'Private host'}],Credentials:[{VaultItemId:'item'}]};
  const envelope=one.encrypt(input);
  assert.deepEqual(one.decrypt(envelope),input);
  assert.equal(Object.keys(envelope).sort().join(','),'data,iv,salt,tag');
  assert.ok(!JSON.stringify(envelope).includes('Private host'));
  const other=new SyncClient({});
  other.passphrase='wrong-but-valid-phrase-2026';
  assert.throws(()=>other.decrypt(envelope));
  assert.throws(()=>one.decrypt({...envelope,data:Buffer.from('corrupt').toString('base64')}));
});
test('no sync token or private passphrase survives logout',()=>{
  const client=new SyncClient({});
  client.user='test';client.token='not-real-token';client.passphrase='secret';client.revision=3;
  client.logout();
  assert.equal(client.status().connected,false);
  assert.equal(client.passphrase,'');
  assert.equal(client.revision,null);
});

test('Vaultwarden access is routed through ShiroTerm Server, never a local CLI',async()=>{
  const client=new SyncClient({});
  await assert.rejects(client.vaultItems(),/Log in to Sync first/);
  client.token='test-token';client.passphrase='test-independent-passphrase';
  const calls=[];
  client.request=async(method,route,payload)=>{
    calls.push({method,route,payload});
    if(route==='/v1/vault/password')return {password:'runtime-only-secret'};
    if(route==='/v1/vault/items')return {items:[]};
    return {connected:true};
  };
  await client.vaultStatus();
  assert.equal(client.vaultConnect,undefined,'Vaultwarden login must be browser-only');
  await client.vaultSync();
  await client.vaultItems();
  assert.equal(await client.vaultPassword('id-placeholder'),'runtime-only-secret');
  await client.vaultDisconnect();
  await client.vaultCreateItem({name:'test',username:'admin',password:'dummy-test'});
  await client.vaultUpdateItem({itemId:'id',name:'test',username:'admin',password:'dummy',
    expectedRevision:'2026-10-01T12:00:00Z'});
  assert.deepEqual(calls.map(c=>c.route),[
    '/v1/vault/status','/v1/vault/sync',
    '/v1/vault/items','/v1/vault/password','/v1/vault/disconnect',
    '/v1/vault/item/create','/v1/vault/item/update']);
  assert.equal(client.status().connected,true);
});

test('failed server revocation clears local state but reports the failure',async()=>{
  const client=new SyncClient({});
  client.token='runtime-token';client.passphrase='device-secret';client.user='user';
  client.request=async()=>{throw Error('connection offline');};
  await assert.rejects(client.signOut(),/could not be confirmed/);
  assert.equal(client.status().connected,false);
  assert.equal(client.passphrase,'');
});
test('logging out revokes the server token before clearing local state',async()=>{
  const client=new SyncClient({});
  client.token='session-token';client.user='testuser';client.passphrase='local-passphrase';
  const routes=[];
  client.request=async(method,route)=>{routes.push(method+':'+route);return {ok:true};};
  const after=await client.signOut();
  assert.deepEqual(routes,['POST:/v1/auth/logout']);
  assert.equal(after.connected,false);
  assert.equal(client.token,'');
  assert.equal(client.passphrase,'');
});
