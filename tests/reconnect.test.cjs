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
async function fixture(drop=true){
  const clients=new Set();
  let shellCount=0;
  const server=new Server({hostKeys:[privateKey]},client=>{
    clients.add(client);
    client.once('close',()=>clients.delete(client));
    client.on('authentication',ctx=>{
      if(ctx.method==='password'&&ctx.username==='tester'&&ctx.password==='demo')
        ctx.accept();
      else ctx.reject();
    });
    client.on('ready',()=>client.on('session',accept=>{
      const session=accept();
      session.on('pty',cb=>cb?.());
      session.on('shell',accept=>{
        shellCount++;
        const stream=accept();
        stream.write('ready\n');
        if(drop)setTimeout(()=>client.end(),45);
      });
    }));
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  return {port:server.address().port,get shellCount(){return shellCount;},
    disconnectAll(){for(const client of clients)client.end();},
    async close(){
      for(const client of clients)client.end();
      await new Promise(resolve=>server.close(resolve));
    }
  };
}
function createLinks(port,{auto=true,stored=true}={}){
  const events=[];
  const host={Id:'reconnect-host',Name:'Reconnect test',Protocol:'SSH',
    Host:'127.0.0.1',Port:port,User:'tester',CredentialId:'',
    KeyFile:'',JumpHost:'',AutoReconnect:auto,SshKeepAliveSeconds:30};
  const known=new Map();
  let links;
  const win={isDestroyed:()=>false,webContents:{send(_channel,event){
    events.push(event);
    if(event.type==='verify')setImmediate(()=>links.acceptHost(event.requestId,true));
  }}};
  links=new Connections(win,{
    config:{Sessions:[host],Credentials:[]},
    passwordForHost:(_host,provided)=>provided|| (stored?'demo':''),
    lookupFingerprint:(name,port)=>known.get(name+':'+port)||null,
    trustFingerprint:(name,port,hash)=>known.set(name+':'+port,{hash})
  });
  links.reconnectDelays=[30,55];
  links.stableUptimeMs=30000;
  return {links,host,events};
}
async function until(events,predicate,timeout=6000){
  const untilAt=Date.now()+timeout;
  while(Date.now()<untilAt){
    const event=events.find(predicate);
    if(event)return event;
    await new Promise(resolve=>setTimeout(resolve,15));
  }
  throw new Error('Missing expected event. Recent: '+JSON.stringify(events.slice(-10)));
}
test('unexpected SSH interruption retries with bounded backoff and same session ID',
{timeout:12000},async()=>{
  const server=await fixture(true);
  const {links,events}=createLinks(server.port);
  const sessionId=crypto.randomUUID();
  try{
    await links.connect({id:'reconnect-host',sessionId});
    await until(events,e=>e.status==='reconnect-exhausted');
    assert.equal(server.shellCount,3,'Initial connection plus two automatic retries');
    const waits=events.filter(e=>e.status==='reconnect-wait');
    assert.deepEqual(waits.map(e=>e.delayMs),[30,55]);
    assert.ok(events.filter(e=>e.status==='reconnect-attempt').every(e=>e.sessionId===sessionId));
    assert.equal(links.sessions.size,0);
    assert.equal(links.reconnect.size,0);
  }finally{links.closeAll();await server.close();}
});
test('cancelling a retry prevents any further connection attempts',
{timeout:9000},async()=>{
  const server=await fixture(true);
  const {links,events}=createLinks(server.port);
  const sessionId=crypto.randomUUID();
  try{
    await links.connect({id:'reconnect-host',sessionId});
    await until(events,e=>e.status==='reconnect-wait');
    assert.equal(links.cancelReconnect(sessionId),true);
    await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(server.shellCount,1);
    assert.equal(links.reconnect.size,0);
    assert.ok(events.some(e=>e.status==='reconnect-stopped'));
  }finally{links.closeAll();await server.close();}
});
test('one-time password and explicit disconnect must never trigger automatic retries',
{timeout:9000},async()=>{
  const server=await fixture(false);
  const {links,events}=createLinks(server.port,{stored:false});
  const sessionId=crypto.randomUUID();
  try{
    await links.connect({id:'reconnect-host',sessionId,password:'demo'});
    await until(events,e=>e.status==='shell-ready');
    assert.equal(links.reconnect.size,0,'One-time secret cannot be retained by retry manager');
    links.disconnect(sessionId);
    await until(events,e=>e.status==='closed');
    await new Promise(resolve=>setTimeout(resolve,110));
    assert.equal(server.shellCount,1);
    assert.equal(events.some(e=>e.status==='reconnect-wait'),false);
  }finally{links.closeAll();await server.close();}
});

test('credential rejection after a successful session stops all further retries',
{timeout:10000},async()=>{
  const server=await fixture(true);
  const {links,events}=createLinks(server.port);
  const sessionId=crypto.randomUUID();
  try{
    await links.connect({id:'reconnect-host',sessionId});
    await until(events,e=>e.sessionId===sessionId&&e.status==='shell-ready');
    links.store.passwordForHost=()=>'invalid-credential';
    await until(events,e=>e.status==='reconnect-attempt');
    await until(events,e=>e.type==='error'&&/authentication methods failed/i.test(e.message));
    await new Promise(resolve=>setTimeout(resolve,160));
    assert.equal(server.shellCount,1,'No successful second login with invalid credentials');
    assert.equal(events.filter(e=>e.status==='reconnect-attempt').length,1,
      'Authentication failures must not retry repeatedly');
    assert.equal(links.reconnect.size,0);
  }finally{links.closeAll();await server.close();}
});
