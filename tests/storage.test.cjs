'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store,normalizeHost,importLegacyJson}=require('../electron/storage.cjs');

test('legacy profiles import without encrypted credential payloads',()=>{
  const imported=importLegacyJson({Sessions:[
    {Id:'abc',Name:'Router',Host:'192.0.2.1',Port:2022,Protocol:'SSH',
     User:'admin',CredentialId:'creda',Favorite:true,Tags:'network',Secret:'never-copy'},
    {Name:'bad record',Host:''}
  ],Folders:[{Id:'group',Name:'Network'}],Macros:[{Id:'snip-1',Name:'Update',Command:'apt update'}],
    Credentials:[{Id:'creda',Name:'Admin',User:'root',Notes:'from legacy',Secret:'must-not-copy'}]});
  assert.equal(imported.Sessions.length,1);
  assert.equal(imported.Sessions[0].Port,2022);
  assert.equal(imported.Sessions[0].CredentialId,'creda');
  assert.equal(imported.Credentials[0].User,'root');
  assert.equal(imported.Credentials[0].Secret,undefined);
  assert.equal(imported.Sessions[0].Favorite,true);
  assert.equal(imported.Sessions[0].Secret,undefined);
  assert.equal(imported.Folders[0].Name,'Network');
  assert.equal(imported.Macros[0].Command,'apt update');
});
test('invalid ports use default and invalid hosts are rejected',()=>{
  assert.equal(normalizeHost({Host:'host',Port:70000}).Port,22);
  assert.throws(()=>normalizeHost({Host:''}));
  assert.equal(normalizeHost({Host:'router',Protocol:'RDP'}).Protocol,'RDP');
  assert.equal(normalizeHost({Host:'remote',Protocol:'RDP'}).Port,3389);
  assert.equal(normalizeHost({Host:'switch',Protocol:'TELNET'}).Port,23);
  assert.equal(normalizeHost({Host:'linux',Protocol:'SSH'}).Port,22);
});
test('store saves atomically and encrypts credentials only',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shiroterm-next-test-'));
  const previous=process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA=path.join(temp,'no-legacy');
  const crypto={
    isEncryptionAvailable:()=>true,
    encryptString:pw=>Buffer.from('sealed:'+pw),
    decryptString:buffer=>buffer.toString().replace(/^sealed:/,'')
  };
  try{
    const store=new Store(path.join(temp,'userdata'),crypto);
    const host=store.saveHost({Id:'one',Host:'example.org',User:'demo',AutoReconnect:true});
    store.savePassword('one','SENSITIVE-TEST-PASSWORD');
    const credential=store.saveCredential({Id:'shared',Name:'Primary',User:'root'});
    store.saveCredentialPassword(credential.Id,'OTHER-ENCRYPTED-TEST');
    const shared=store.saveHost({Id:'host2',Host:'router.internal',CredentialId:'shared'});
    assert.equal(store.passwordForHost(shared),'OTHER-ENCRYPTED-TEST');
    assert.equal(store.passwordForHost(shared,'one-time'),'one-time');
    assert.equal(store.list().Credentials[0].HasStoredPassword,true);
    assert.equal(store.list().Sessions.find(h=>h.Id==='one').HasStoredPassword,true);
    assert.equal(store.list().Sessions.find(h=>h.Id==='host2').HasStoredPassword,false);
    assert.equal(store.list().Sessions[0].Host,'example.org');
    assert.equal(store.list().Sessions[0].AutoReconnect,true);
    store.saveHostDetection('one',{platform:'proxmox',role:'hypervisor',
      version:'pve-manager/9.1'});
    assert.equal(store.list().Sessions.find(h=>h.Id==='one').DetectedPlatform,'proxmox');
    store.saveHost({...store.list().Sessions.find(h=>h.Id==='one'),
      PlatformOverride:'debian'});
    store.saveHostDetection('one',{platform:'proxmox',role:'hypervisor',
      version:'pve-manager/9.2'});
    assert.equal(store.list().Sessions.find(h=>h.Id==='one').PlatformOverride,'debian',
      'Manual icon override remains intact after automatic detection');
    assert.equal(store.readPassword('one'),'SENSITIVE-TEST-PASSWORD');
    const profile=fs.readFileSync(path.join(temp,'userdata','profiles-v2.json'),'utf8');
    const vault=fs.readFileSync(path.join(temp,'userdata','secrets-v2.json'),'utf8');
    assert.ok(!profile.includes('SENSITIVE-TEST-PASSWORD'));
    assert.ok(!vault.includes('SENSITIVE-TEST-PASSWORD'));
    assert.ok(!vault.includes('OTHER-ENCRYPTED-TEST'));
    assert.equal(JSON.parse(profile).Credentials[0].HasStoredPassword,undefined);
    store.removeCredential('shared');
    assert.equal(store.passwordForHost(store.list().Sessions.find(h=>h.Id==='host2')),'');
    assert.equal(store.list().Sessions.find(h=>h.Id==='host2').CredentialId,'');
    assert.equal(store.readPassword('credential:shared'),'');
    store.saveSnippet({Id:'snippet',Name:'Whoami',Command:'whoami'});
    assert.equal(store.list().Macros[0].Command,'whoami');
    store.removeSnippet('snippet');
    assert.equal(store.list().Macros.length,0);
    store.trustFingerprint('example.org',22,'abcdef');
    assert.equal(store.lookupFingerprint('example.org',22).hash,'abcdef');
    assert.equal(store.knownHosts().length,1);
    store.removeKnownHost('example.org:22');
    assert.equal(store.knownHosts().length,0);
    store.removeHost(host.Id);
    store.removeHost(shared.Id);
    assert.equal(store.list().Sessions.length,0);
    assert.equal(store.readPassword('one'),'');
  } finally {
    if(previous===undefined)delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA=previous;
    fs.rmSync(temp,{recursive:true,force:true});
  }
});

test('existing Next store receives legacy credential metadata without copying secrets',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shiroterm-credential-migration-'));
  const previous=process.env.LOCALAPPDATA;
  const local=path.join(temp,'local');
  const legacyDir=path.join(local,'ShiroTerm','ProfileData');
  const userData=path.join(temp,'app');
  fs.mkdirSync(legacyDir,{recursive:true});
  fs.mkdirSync(userData,{recursive:true});
  const legacy={Sessions:[{Id:'host',Host:'router',CredentialId:'legacy'}],
    Credentials:[{Id:'legacy',Name:'Router Admin',User:'admin',Secret:'DO-NOT-IMPORT'}]};
  const legacyPath=path.join(legacyDir,'config.json');
  fs.writeFileSync(legacyPath,JSON.stringify(legacy));
  const legacyBefore=fs.readFileSync(legacyPath,'utf8');
  fs.writeFileSync(path.join(userData,'profiles-v2.json'),JSON.stringify({
    Sessions:[{Id:'host',Host:'router',CredentialId:'legacy'}],
    Folders:[],Macros:[],imported:true
  }));
  process.env.LOCALAPPDATA=local;
  try{
    const store=new Store(userData,{isEncryptionAvailable:()=>false});
    assert.equal(store.list().Credentials.length,1);
    assert.equal(store.list().Credentials[0].Name,'Router Admin');
    assert.equal(store.list().Credentials[0].HasStoredPassword,false);
    assert.equal(store.list().Credentials[0].Secret,undefined);
    assert.equal(fs.readFileSync(legacyPath,'utf8'),legacyBefore);
    assert.ok(!fs.readFileSync(store.configFile,'utf8').includes('DO-NOT-IMPORT'));
  }finally{
    if(previous===undefined)delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA=previous;
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
