'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {fixture,login,ADMIN_PASSWORD}=require('./helpers.cjs');
const {createService}=require('../app.cjs');
const {configFromEnv}=require('../lib/config.cjs');
const {RateLimit}=require('../lib/auth.cjs');
const blob=()=>({salt:crypto.randomBytes(16).toString('base64'),iv:crypto.randomBytes(12).toString('base64'),
  tag:crypto.randomBytes(16).toString('base64'),data:crypto.randomBytes(48).toString('base64')});
const bearer=token=>({Authorization:'Bearer '+token});
async function device(f,browser,label='Test desktop'){
  const start=await f.request('/v1/device/start',{body:{label}});
  assert.equal(start.status,201);
  const approved=await f.request('/console/api/device/approve',{body:{code:start.body.code},headers:browser.headers});
  assert.equal(approved.status,200);
  const result=await f.request('/v1/device/poll',{body:{id:start.body.id,secret:start.body.secret}});
  assert.equal(result.status,200);return result.body;
}

test('server refuses insecure production URLs and requires a private bootstrap password',async()=>{
  assert.throws(()=>configFromEnv({PUBLIC_URL:'http://example.com'}),/HTTPS/);
  for(const value of ['https://user:pass@example.com','https://example.com/path','https://example.com/?token=secret'])
    assert.throws(()=>configFromEnv({PUBLIC_URL:value}),/HTTPS/);
  const f=await fixture();
  try{
    await assert.rejects(createService({config:{...f.config,dataDir:path.join(f.dir,'uninitialized'),adminPasswordFile:''}}),/ADMIN_PASSWORD_FILE/);
    assert.equal((await f.request('/healthz')).body.status,'ok');
    const row=f.service.db.get('SELECT password FROM users WHERE username=?','admin');
    assert.ok(!row.password.includes(ADMIN_PASSWORD));
    assert.match(row.password,/^[a-f0-9]{32}:[a-f0-9]{64}$/);
    assert.equal((await f.request('/v1/snapshot')).status,401);
    assert.equal((await f.request('/console/api/users')).status,401);
    const page=await f.request('/console');assert.equal(page.status,200);
    assert.match(page.headers['content-security-policy'],/frame-ancestors 'none'/);
    assert.equal(page.headers['cache-control'],'no-store');
    assert.equal((await f.request('/console/../../package.json')).status,404);
  }finally{await f.close();}
});

test('browser cookies, CSRF and user roles protect account and device management',async()=>{
  const f=await fixture();
  try{
    const bad=await f.request('/console/api/login',{body:{username:'admin',password:ADMIN_PASSWORD},headers:{Origin:'https://other.example'}});
    assert.equal(bad.status,403);
    assert.equal((await f.request('/console/api/login',{body:{username:'admin',password:'wrong'},headers:{Origin:f.base}})).status,401);
    const browser=await login(f);
    assert.match(browser.cookie,/^shiro_session=[A-Za-z0-9_-]{64}$/);
    const result=await f.request('/console/api/users',{body:{username:'alice',password:'alice-fixture-password'},headers:browser.headers});
    assert.equal(result.status,201);
    assert.equal((await f.request('/console/api/users',{body:{username:'bobby',password:'fixture-password-for-bob'},headers:{Cookie:browser.cookie,Origin:f.base}})).status,403);
    const alice=await login(f,'alice','alice-fixture-password');
    assert.equal((await f.request('/console/api/users',{headers:alice.headers})).status,404);
    assert.equal((await f.request('/console/api/user/disable',{body:{username:'admin'},headers:browser.headers})).status,400);
    assert.equal((await f.request('/console/api/session',{headers:alice.headers})).body.user,'alice');
    const cookie=f.service.auth.cookie('x',30);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
    f.config.publicUrl='https://sync.example.test';assert.match(f.service.auth.cookie('x',30),/Secure/);
  }finally{await f.close();}
});

test('pairing is secret-bound, one-time, expiring, persistent and revocable',async()=>{
  const f=await fixture();
  try{
    const browser=await login(f);
    const pending=(await f.request('/v1/device/start',{body:{label:'My Linux desktop'}})).body;
    assert.equal(pending.portalUrl,f.base+'/console');
    assert.equal((await f.request('/v1/device/poll',{body:{id:pending.id,secret:pending.secret}})).body.status,'pending');
    assert.equal((await f.request('/v1/device/poll',{body:{id:pending.id,secret:'a'.repeat(64)}})).status,410);
    const preview=await f.request('/console/api/pairing?code='+pending.code,{headers:browser.headers});
    assert.equal(preview.body.label,'My Linux desktop');assert.equal(preview.body.secret,undefined);
    assert.equal((await f.request('/console/api/device/approve',{body:{code:pending.code},headers:browser.headers})).status,200);
    assert.equal((await f.request('/console/api/device/approve',{body:{code:pending.code},headers:browser.headers})).status,409);
    const approved=(await f.request('/v1/device/poll',{body:{id:pending.id,secret:pending.secret}})).body;
    assert.match(approved.token,/^[A-Za-z0-9_-]{64}$/);assert.ok(approved.expires>Math.floor(Date.now()/1000));
    assert.equal(approved.csrf,undefined);
    assert.equal((await f.request('/v1/device/poll',{body:{id:pending.id,secret:pending.secret}})).status,410);
    assert.equal((await f.request('/v1/snapshot',{headers:bearer(approved.token)})).status,200);
    const stored=f.service.db.all('SELECT * FROM sessions');
    assert.ok(!JSON.stringify(stored).includes(approved.token));
    const devices=(await f.request('/console/api/devices',{headers:browser.headers})).body.devices;
    assert.equal(devices.length,1);
    await f.request('/console/api/device/revoke',{body:{id:devices[0].id},headers:browser.headers});
    assert.equal((await f.request('/v1/snapshot',{headers:bearer(approved.token)})).status,401);
    const expires=(await f.request('/v1/device/start',{body:{}})).body;f.advance(601);
    assert.equal((await f.request('/v1/device/poll',{body:{id:expires.id,secret:expires.secret}})).status,410);
  }finally{await f.close();}
});

test('encrypted snapshots enforce compare-and-swap, bounded history and account isolation',async()=>{
  const f=await fixture();
  try{
    const browser=await login(f),desktop=await device(f,browser);
    const headers=bearer(desktop.token),first=blob();
    assert.deepEqual((await f.request('/v1/snapshot',{headers})).body,{revision:0,blob:null,updated:0});
    assert.equal((await f.request('/v1/snapshot',{method:'PUT',headers,body:{expected_revision:0,blob:first}})).body.revision,1);
    assert.deepEqual((await f.request('/v1/snapshot',{headers})).body.blob,first);
    const race=await Promise.all([2,3].map(()=>f.request('/v1/snapshot',{method:'PUT',headers,body:{expected_revision:1,blob:blob()}})));
    assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    assert.equal((await f.request('/v1/history/1',{headers})).body.revision,1);
    for(let current=2;current<5;current++)assert.equal((await f.request('/v1/snapshot',
      {method:'PUT',headers,body:{expected_revision:current,blob:blob()}})).status,200);
    assert.deepEqual((await f.request('/v1/history',{headers})).body.versions.map(v=>v.revision),[5,4,3]);
    assert.equal((await f.request('/v1/history/1',{headers})).status,404);
    const privateVault=(await f.request('/v1/profile-vaults',{headers,body:{name:'Production'}})).body;
    assert.match(privateVault.id,/^[a-f0-9]{32}$/);
    assert.equal((await f.request('/v1/profile-vaults/'+privateVault.id+'/snapshot',{headers})).body.revision,0);
    await f.request('/console/api/users',{headers:browser.headers,body:{username:'alice',password:'alice-password-fixture'}});
    const alice=(await f.request('/v1/auth/login',{body:{username:'alice',password:'alice-password-fixture'}})).body;
    assert.equal((await f.request('/v1/profile-vaults/'+privateVault.id+'/snapshot',{headers:bearer(alice.token)})).status,404);
    assert.equal((await f.request('/v1/snapshot',{headers:bearer(alice.token)})).body.revision,0);
    assert.equal((await f.request('/v1/profile-vaults',{headers})).body.vaults.length,2);
  }finally{await f.close();}
});

test('invalid envelopes, oversized requests and token expiry never modify snapshots',async()=>{
  const f=await fixture();
  try{
    const desktop=await device(f,await login(f)),headers=bearer(desktop.token);
    for(const input of [{blob:blob()},{expected_revision:-1,blob:blob()},
      {expected_revision:0,blob:{...blob(),password:'plaintext'}},
      {expected_revision:0,blob:{...blob(),iv:'invalid'}},
      {expected_revision:0,blob:{Sessions:[]}}])
      assert.equal((await f.request('/v1/snapshot',{method:'PUT',headers,body:input})).status,400);
    assert.equal((await f.request('/v1/snapshot',{method:'PUT',headers,rawBody:'{broken'})).status,400);
    assert.equal((await f.request('/v1/snapshot',{method:'PUT',headers:{...headers,'Content-Type':'text/plain'},rawBody:'{}'})).status,415);
    assert.equal((await f.request('/v1/snapshot',{method:'PUT',headers,body:{data:'x'.repeat(1900001)}})).status,413);
    assert.equal((await f.request('/v1/snapshot',{headers})).body.revision,0);
    const large={...blob(),data:crypto.randomBytes(1000000).toString('base64')};
    assert.equal((await f.request('/v1/snapshot',{method:'PUT',headers,body:{expected_revision:0,blob:large}})).status,200);
    f.advance(31*86400);
    assert.equal((await f.request('/v1/snapshot',{headers})).status,401);
  }finally{await f.close();}
});

test('sessions and snapshots survive restart without the bootstrap password file',async()=>{
  const f=await fixture();let again;
  try{
    const desktop=await device(f,await login(f)),headers=bearer(desktop.token);
    const payload=blob();await f.request('/v1/snapshot',{method:'PUT',headers,body:{expected_revision:0,blob:payload}});
    await f.service.close();fs.unlinkSync(f.config.adminPasswordFile);
    again=await createService({config:f.config});
    await new Promise(resolve=>again.server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+again.server.address().port;
    const {request}=require('./helpers.cjs');
    assert.deepEqual((await request(base,'/v1/snapshot',{headers})).body.blob,payload);
    assert.ok(fs.existsSync(path.join(f.config.dataDir,'shiroterm.sqlite')));
  }finally{if(again)await again.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});

test('password changes and account disable revoke device access',async()=>{
  const f=await fixture();
  try{
    const admin=await login(f),desktop=await device(f,admin);
    assert.equal((await f.request('/console/api/password',{headers:admin.headers,
      body:{currentPassword:ADMIN_PASSWORD,newPassword:'new-admin-password-fixture'}})).status,200);
    assert.equal((await f.request('/v1/snapshot',{headers:bearer(desktop.token)})).status,401);
    assert.equal((await f.request('/console/api/session',{headers:admin.headers})).body.authenticated,true);
    await f.request('/console/api/users',{headers:admin.headers,body:{username:'alice',password:'alice-password-fixture'}});
    const alice=await device(f,await login(f,'alice','alice-password-fixture'));
    await f.request('/console/api/user/disable',{headers:admin.headers,body:{username:'alice'}});
    assert.equal((await f.request('/v1/snapshot',{headers:bearer(alice.token)})).status,401);
    assert.equal((await f.request('/v1/auth/login',{body:{username:'alice',password:'alice-password-fixture'}})).status,401);
    assert.equal((await f.request('/console/api/user/enable',{headers:admin.headers,body:{username:'alice'}})).status,200);
    assert.equal((await f.request('/v1/auth/login',{body:{username:'alice',password:'alice-password-fixture'}})).status,200);
  }finally{await f.close();}
});

test('optional Vaultwarden is harmless while disabled and rate limiting is bounded',async()=>{
  const f=await fixture();
  try{
    const desktop=await device(f,await login(f)),headers=bearer(desktop.token);
    assert.equal((await f.request('/v1/vault/status',{headers})).body.configured,false);
    assert.equal((await f.request('/v1/vault/items',{headers})).status,503);
    const limiter=new RateLimit(()=>1000);
    limiter.take('test',1,1000);assert.throws(()=>limiter.take('test',1,1000),/Too many/);
    for(let i=0;i<20;i++)await f.request('/v1/device/start',{body:{label:'Rate limit fixture'}});
    assert.equal((await f.request('/v1/device/start',{body:{}})).status,429);
    assert.equal((await f.request('/v1/device/start',{body:{}})).headers['retry-after'],'60');
  }finally{await f.close();}
});
