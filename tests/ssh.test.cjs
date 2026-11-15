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
const password='fixture-only-secret';
async function serve(){
  let shellCount=0;
  const server=new Server({hostKeys:[privateKey]},client=>{
    client.on('authentication',ctx=>{
      if(ctx.method==='password'&&ctx.username==='tester'&&ctx.password===password)
        ctx.accept();
      else ctx.reject();
    });
    client.on('ready',()=>{
      client.on('session',accept=>{
        const session=accept();
        session.on('pty',accept=>accept&&accept());
        session.on('shell',accept=>{
          shellCount++;
          const stream=accept();
          stream.write('server-ready\n');
          stream.on('data',chunk=>stream.write(chunk));
        });
      });
    });
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  return {server,port:server.address().port,get shellCount(){return shellCount;}};
}
async function until(events,predicate,timeout=7000){
  const started=Date.now();
  while(Date.now()-started<timeout){
    const item=events.find(predicate);
    if(item)return item;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error('Timed out waiting for '+predicate.toString()+'; last='+JSON.stringify(events.slice(-4)));
}
test('SSH identity verification, shared password, and shell bytes', {timeout:15000}, async()=>{
  const {server,port}=await serve();
  const events=[];
  const known=new Map();
  const sessionId=crypto.randomUUID();
  const win={isDestroyed:()=>false,webContents:{send(_channel,event){
    events.push(event);
    if(event.type==='verify')
      setImmediate(()=>links.acceptHost(event.requestId,true));
  }}};
  const store={
    config:{Sessions:[{Id:'host',Protocol:'SSH',Host:'127.0.0.1',Port:port,
      User:'',CredentialId:'cred',KeyFile:'',SshKeepAliveSeconds:30}],
      Credentials:[{Id:'cred',User:'tester'}]},
    passwordForHost:()=>password,
    lookupFingerprint:(host,p)=>known.get(host+':'+p)||null,
    trustFingerprint:(host,p,hash)=>known.set(host+':'+p,{hash})
  };
  const links=new Connections(win,store);
  try{
    const response=await links.connect({id:'host',sessionId,cols:96,rows:30});
    assert.equal(response.sessionId,sessionId);
    await until(events,e=>e.type==='status'&&e.status==='shell-ready');
    assert.equal(known.size,1);
    assert.equal(events.some(e=>e.type==='verify'),true);
    links.write(sessionId,'ping-echo\n');
    await until(events,e=>e.type==='data'&&e.data.includes('ping-echo'));
    assert.equal(links.sessions.get(sessionId).cols,96);
    assert.equal(links.sessions.get(sessionId).rows,30);
    links.resize(sessionId,105,36);
    assert.equal(links.sessions.get(sessionId).cols,105);
    assert.equal(links.sessions.get(sessionId).rows,36);
  }finally{
    links.closeAll();
    await new Promise(resolve=>server.close(resolve));
  }
});
test('SFTP-only profile connects without trying to open a shell', {timeout:15000}, async()=>{
  const service=await serve();
  const events=[];
  const identity=new Map();
  const win={isDestroyed:()=>false,webContents:{send(_channel,event){
    events.push(event);
    if(event.type==='verify')setImmediate(()=>links.acceptHost(event.requestId,true));
  }}};
  const store={
    config:{Sessions:[{Id:'sftp-host',Protocol:'SFTP',Host:'127.0.0.1',
      Port:service.port,User:'tester',CredentialId:'',KeyFile:'',SshKeepAliveSeconds:30}],
      Credentials:[]},
    passwordForHost:()=>password,
    lookupFingerprint:(host,p)=>identity.get(host+':'+p)||null,
    trustFingerprint:(host,p,hash)=>identity.set(host+':'+p,{hash})
  };
  const links=new Connections(win,store);
  try{
    await links.connect({id:'sftp-host'});
    await until(events,e=>e.type==='status'&&e.status==='sftp-ready');
    assert.equal(service.shellCount,0);
  }finally{
    links.closeAll();
    await new Promise(resolve=>service.server.close(resolve));
  }
});
