'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {secureStorageAvailable}=require('../electron/secure-storage.cjs');
const {Store}=require('../electron/storage.cjs');
const {SyncClient}=require('../electron/sync.cjs');

test('Linux plaintext fallback cannot save passwords or remember device tokens',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shiro-keyring-'));
  const storage={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'basic_text',
    encryptString:()=>{throw Error('insecure encryption must never be called');}};
  try{
    assert.equal(secureStorageAvailable(storage),false);
    const store=new Store(dir,storage);
    assert.throws(()=>store.savePassword('host','secret'),/keyring/);
    const client=new SyncClient(store);
    client.user='testuser';client.token='a'.repeat(64);
    assert.equal(client.saveSession(),false);
    assert.equal(client.status().remembered,false);
    assert.equal(fs.existsSync(client.sessionFile),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
  assert.equal(secureStorageAvailable({isEncryptionAvailable:()=>true,
    getSelectedStorageBackend:()=> 'gnome_libsecret'}),true);
  assert.equal(secureStorageAvailable({isEncryptionAvailable:()=>true}),true);
});

test('fresh local startup never needs a server or requests a connection',async()=>{
  const client=new SyncClient({});
  client.request=()=>{throw Error('startup must not contact an unconfigured server');};
  assert.equal(client.status().url,'');
  assert.equal(client.status().connected,false);
  assert.equal(await client.restoreSession(),false);
  assert.equal((await client.vaultStatus()).connected,false);
});

test('configured HTTPS server survives restart without storing login secrets in settings',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shiro-endpoint-'));
  try{
    const first=new SyncClient({dir});
    first.request=async()=>({id:'x',secret:'private-pairing-secret',code:'ABCD-EFGH',expiresIn:300,
      portalUrl:'https://sync.example.test/console'});
    await first.pairStart({url:'https://sync.example.test/'});
    const next=new SyncClient({dir});
    assert.equal(next.endpoint,'https://sync.example.test');
    assert.equal(next.consoleUrl(),'https://sync.example.test/console');
    assert.deepEqual(JSON.parse(fs.readFileSync(next.settingsFile,'utf8')),
      {url:'https://sync.example.test'});
    assert.throws(()=>next.request('GET','https://other.example.test/steal'),/configured server/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('pairing rejects authorization pages on another origin',async()=>{
  const client=new SyncClient({});
  client.request=async()=>({portalUrl:'https://other.example.test/console'});
  await assert.rejects(client.pairStart({url:'https://sync.example.test'}),/configured server/);
  assert.equal(client.pairing,null);
});
