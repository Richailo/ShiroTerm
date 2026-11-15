'use strict';
// Runs on a Linux CI host with Docker; never uses a user's server or profile.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const image=process.env.SHIROTERM_TEST_IMAGE||'shiroterm-server:test';
const name='shiroterm-test-'+crypto.randomBytes(6).toString('hex');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shiroterm-container-'));
const secret=path.join(dir,'admin_password'),password=crypto.randomBytes(24).toString('base64url');
fs.writeFileSync(secret,password,{mode:0o444});fs.chmodSync(secret,0o444);
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
(async()=>{
  try{
    assert.equal(docker(['image','inspect',image,'--format','{{.Config.User}}']),'node:node');
    docker(['volume','create',name]);
    const args=['run','-d','--name',name,'--read-only','--tmpfs','/tmp:size=128m,mode=1777',
      '--cap-drop','ALL','--security-opt','no-new-privileges',
      '--mount','type=volume,source='+name+',target=/data',
      '--mount','type=bind,source='+secret+',target=/run/secrets/admin_password,readonly',
      '-e','PUBLIC_URL=http://127.0.0.1','-e','ALLOW_HTTP=true','-e','ADMIN_PASSWORD_FILE=/run/secrets/admin_password',
      '-p','127.0.0.1::8080',image];
    docker(args);
    const address=docker(['port',name,'8080/tcp']).split('\n')[0];let base='http://'+address;
    let healthy=false;
    for(let attempt=0;attempt<60;attempt++){
      try{healthy=(await fetch(base+'/healthz')).ok;}catch{}
      if(healthy)break;await delay(500);
    }
    assert.equal(healthy,true,'Container did not become healthy');
    const login=await fetch(base+'/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:'admin',password})});
    assert.equal(login.status,200);
    const {token}=await login.json();
    const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
    const blob={salt:crypto.randomBytes(16).toString('base64'),iv:crypto.randomBytes(12).toString('base64'),
      tag:crypto.randomBytes(16).toString('base64'),data:crypto.randomBytes(32).toString('base64')};
    const save=await fetch(base+'/v1/snapshot',{method:'PUT',headers,body:JSON.stringify({expected_revision:0,blob})});
    assert.equal(save.status,200);
    docker(['restart',name]);
    base='http://'+docker(['port',name,'8080/tcp']).split('\n')[0];
    for(let attempt=0;attempt<60;attempt++){
      try{if((await fetch(base+'/healthz')).ok)break;}catch{}await delay(500);
    }
    const restored=await fetch(base+'/v1/snapshot',{headers});
    assert.equal(restored.status,200);assert.equal((await restored.json()).revision,1);
    assert.match(docker(['exec','-e','BITWARDENCLI_APPDATA_DIR=/tmp/bw-version',name,'bw','--version']),/^2026\.10\.1/);
    console.log('CONTAINER_NONROOT_READONLY_RESTART_AND_SYNC_PASS');
  }catch(error){
    try{console.error(docker(['logs',name]));}catch{}
    throw error;
  }finally{
    try{docker(['rm','-f',name]);}catch{}
    try{docker(['volume','rm',name]);}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
