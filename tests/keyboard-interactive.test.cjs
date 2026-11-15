'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Server}=require('ssh2');
const {Connections}=require('../electron/ssh.cjs');

const {privateKey}=crypto.generateKeyPairSync('rsa',{
  modulusLength:2048,
  privateKeyEncoding:{type:'pkcs1',format:'pem'},
  publicKeyEncoding:{type:'spki',format:'pem'}
});
async function fixture(prompt='Password:'){
  let authenticated=0,blocked=0;
  const server=new Server({hostKeys:[privateKey]},client=>{
    client.on('authentication',ctx=>{
      if(ctx.method!=='keyboard-interactive'){ctx.reject(['keyboard-interactive']);return;}
      ctx.prompt([{prompt,echo:false}],answers=>{
        if(answers[0]==='fixture-password'){authenticated++;ctx.accept();}
        else{blocked++;ctx.reject();}
      });
    });
    client.on('ready',()=>client.on('session',accept=>{
      const session=accept();
      session.on('pty',callback=>callback?.());
      session.on('shell',accept=>accept().write('ready\n'));
    }));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,port:server.address().port,
    get authenticated(){return authenticated;},get blocked(){return blocked;}};
}
async function waitFor(events,predicate,limit=5000){
  const deadline=Date.now()+limit;
  while(Date.now()<deadline){
    if(events.some(predicate))return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw Error('Expected SSH event missing: '+JSON.stringify(events.slice(-5)));
}
test('keyboard-interactive SSH password succeeds without a second user prompt',
{timeout:10000},async()=>{
  const service=await fixture();
  const events=[];
  const win={isDestroyed:()=>false,webContents:{send(_channel,event){
    events.push(event);
    if(event.type==='verify')setImmediate(()=>links.acceptHost(event.requestId,true));
  }}};
  const store={
    config:{Sessions:[{Id:'kb',Name:'Keyboard auth',Host:'127.0.0.1',Port:service.port,
      User:'tester',Protocol:'SSH',CredentialId:'',KeyFile:'',JumpHost:'',
      SshKeepAliveSeconds:30}],Credentials:[]},
    passwordForHost:(_host,provided)=>provided,
    lookupFingerprint:()=>null,trustFingerprint:()=>{}
  };
  const links=new Connections(win,store);
  try{
    await links.connect({id:'kb',password:'fixture-password'});
    await waitFor(events,e=>e.status==='shell-ready');
    assert.equal(service.authenticated,1);
  }finally{
    links.closeAll();
    await new Promise(resolve=>service.server.close(resolve));
  }
});
test('SSH password is not automatically used for MFA one-time-code prompts',
{timeout:10000},async()=>{
  const service=await fixture('Verification code:');
  const events=[];
  const win={isDestroyed:()=>false,webContents:{send(_channel,event){
    events.push(event);
    if(event.type==='verify')setImmediate(()=>links.acceptHost(event.requestId,true));
  }}};
  const store={
    config:{Sessions:[{Id:'mfa',Name:'MFA host',Host:'127.0.0.1',Port:service.port,
      User:'tester',Protocol:'SSH',CredentialId:'',KeyFile:'',JumpHost:'',
      SshKeepAliveSeconds:30}],Credentials:[]},
    passwordForHost:(_host,provided)=>provided,
    lookupFingerprint:()=>null,trustFingerprint:()=>{}
  };
  const links=new Connections(win,store);
  try{
    await links.connect({id:'mfa',password:'fixture-password'});
    await waitFor(events,e=>e.type==='error');
    assert.equal(service.authenticated,0);
    assert.ok(service.blocked>=1);
  }finally{
    links.closeAll();
    await new Promise(resolve=>service.server.close(resolve));
  }
});
