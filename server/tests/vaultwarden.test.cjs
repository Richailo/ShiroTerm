'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {Vaultwarden}=require('../lib/vaultwarden.cjs');

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shiroterm-vault-test-'));
  let now=1000;const calls=[],items=new Map();
  const personal={id:'11111111-1111-1111-1111-111111111111',name:'SSH login',type:1,organizationId:null,
    revisionDate:'2026-11-15T10:00:00Z',notes:'Keep this note',login:{username:'demo',password:'private-vault-password',uris:[{uri:'ssh://192.0.2.10'}]}};
  const organization={...personal,id:'22222222-2222-2222-2222-222222222222',organizationId:'org'};
  items.set(personal.id,personal);items.set(organization.id,organization);
  const run=(binary,args,options)=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
    child.kill=()=>{};let input='';child.stdin.on('data',c=>{input+=c;});
    child.stdin.on('finish',()=>queueMicrotask(()=>{
      const call={binary,args,options,input};calls.push(call);
      let result='';
      if(args[0]==='login')result=crypto.randomBytes(32).toString('base64');
      if(args[0]==='list')result=JSON.stringify([...items.values(),{type:3,name:'Card'}]);
      if(args[0]==='get')result=JSON.stringify(items.get(args[2]));
      if(args[0]==='edit'||args[0]==='create'){
        const value=JSON.parse(Buffer.from(input.trim(),'base64').toString('utf8'));
        value.id=args[0]==='edit'?args[2]:crypto.randomUUID();value.revisionDate='2026-11-15T11:00:00Z';
        items.set(value.id,value);result=JSON.stringify(value);
      }
      child.stdout.end(result);child.stderr.end();child.emit('close',0);
    }));
    return child;
  };
  const vault=new Vaultwarden({vaultUrl:'https://vault.example.test',dataDir:dir,bwPath:'fixture-bw',vaultMinutes:60},{run,now:()=>now});
  return {vault,dir,calls,items,personal,organization,advance:seconds=>{now+=seconds;},close(){vault.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

test('Vaultwarden isolates accounts and passes master passwords and session keys outside argv',async()=>{
  const f=fixture();
  try{
    await f.vault.connect('alice',{email:'alice@example.test',password:'private-master-password'});
    await f.vault.connect('bobby',{email:'bob@example.test',password:'other-master-password'});
    assert.equal(f.vault.status('alice').connected,true);
    assert.equal(f.vault.status('bobby').account,'bob@example.test');
    assert.equal(f.vault.status('alice').itemCount,2);
    const logins=f.calls.filter(c=>c.args[0]==='login');
    assert.notEqual(logins[0].options.env.BITWARDENCLI_APPDATA_DIR,logins[1].options.env.BITWARDENCLI_APPDATA_DIR);
    for(const call of f.calls){
      assert.equal(call.options.shell,false);
      assert.ok(!call.args.join(' ').includes('private-master-password'));
      assert.ok(!call.args.join(' ').includes(f.vault.sessions.get('alice').key));
    }
    const list=await f.vault.items('alice');
    assert.equal(list.items[0].password,undefined);assert.equal(list.items[1].organization,true);
    assert.equal((await f.vault.password('alice',f.personal.id)).password,'private-vault-password');
    await f.vault.disconnect('alice');assert.equal(f.vault.status('alice').connected,false);
    await assert.rejects(f.vault.password('alice',f.personal.id),/Unlock Vaultwarden/);
    assert.equal(f.vault.status('bobby').connected,true);
    f.advance(3601);assert.equal(f.vault.status('bobby').connected,false);
  }finally{f.close();}
});

test('Vaultwarden writes use stdin, preserve metadata and reject stale or organization changes',async()=>{
  const f=fixture();
  try{
    await f.vault.connect('alice',{email:'alice@example.test',password:'private-master-password'});
    const input={itemId:f.personal.id,name:'Updated login',username:'root',password:'new-private-password',expectedRevision:f.personal.revisionDate};
    await assert.rejects(f.vault.write('alice',{...input,expectedRevision:'stale'},true),/changed/);
    await assert.rejects(f.vault.write('alice',{...input,itemId:f.organization.id},true),/personal login/);
    await f.vault.write('alice',input,true);
    assert.equal(f.items.get(f.personal.id).notes,'Keep this note');
    assert.equal(f.items.get(f.personal.id).login.uris[0].uri,'ssh://192.0.2.10');
    const edit=f.calls.find(c=>c.args[0]==='edit');
    assert.ok(!edit.args.join(' ').includes('new-private-password'));
    assert.equal(JSON.parse(Buffer.from(edit.input.trim(),'base64').toString('utf8')).login.password,'new-private-password');
    const created=await f.vault.write('alice',{name:'New login',username:'demo',password:'fixture-new-password'});
    assert.match(created.id,/^[a-f0-9-]{36}$/);
    await assert.rejects(f.vault.password('alice','../../private'),/Invalid Vaultwarden/);
  }finally{f.close();}
});
