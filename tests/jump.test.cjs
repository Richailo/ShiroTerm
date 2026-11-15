'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const net=require('node:net');
const {Server}=require('ssh2');
const {Connections}=require('../electron/ssh.cjs');

function keypair(){
  return crypto.generateKeyPairSync('rsa',{
    modulusLength:2048,
    privateKeyEncoding:{type:'pkcs1',format:'pem'},
    publicKeyEncoding:{type:'spki',format:'pem'}
  }).privateKey;
}
function profile(id,port,name,username,secretId){
  return {Id:id,Name:name,Protocol:'SSH',Host:'127.0.0.1',
    Port:port,User:username,CredentialId:secretId||'',
    KeyFile:'',JumpHost:'',SshKeepAliveSeconds:30};
}
async function launchServer(key,username,password){
  const clients=new Set();
  let shellCount=0;
  const server=new Server({hostKeys:[key]},client=>{
    clients.add(client);
    client.once('close',()=>clients.delete(client));
    client.on('authentication',ctx=>{
      if(ctx.method==='password'&&ctx.username===username&&ctx.password===password)
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
          stream.write('target-shell-ready\n');
          stream.on('data',buf=>stream.write(buf));
        });
      });
    });
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  return {
    port:server.address().port,
    server,clients,get shellCount(){return shellCount;},
    async close(){
      for(const client of clients)client.end();
      await new Promise(resolve=>server.close(resolve));
    }
  };
}
async function until(events,predicate,timeout=5500){
  const start=Date.now();
  while(Date.now()-start<timeout){
    if(events.some(predicate))return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('Event missing: '+JSON.stringify(events.slice(-7)));
}

test('jump host forwards SSH stream; each host key and credential verified independently',
{timeout:16000},async()=>{
  const target=await launchServer(keypair(),'target-user','target-secret');
  let forwarded=0;
  const jumpServers=new Set();
  const sockets=new Set();
  const gatewayServer=new Server({hostKeys:[keypair()]},connection=>{
    connection.on('authentication',ctx=>{
      if(ctx.method==='password'&&ctx.username==='gateway-user'&&ctx.password==='gateway-secret')
        ctx.accept();
      else ctx.reject();
    });
    connection.on('ready',()=>connection.on('tcpip',(accept,reject,info)=>{
      if(info.destPort!==target.port){reject();return;}
      forwarded++;
      const channel=accept();
      const socket=net.connect(target.port,'127.0.0.1');
      sockets.add(socket);
      socket.on('close',()=>sockets.delete(socket));
      channel.on('error',()=>socket.destroy());
      socket.on('error',()=>channel.destroy());
      socket.on('close',()=>channel.destroy());
      channel.on('close',()=>socket.destroy());
      channel.pipe(socket).pipe(channel);
    }));
    jumpServers.add(connection);
    connection.on('close',()=>jumpServers.delete(connection));
  });
  await new Promise(resolve=>gatewayServer.listen(0,'127.0.0.1',resolve));
  const gatewayProfile=profile('jump',gatewayServer.address().port,
    'Gateway','gateway-user');
  const targetProfile=profile('destination',target.port,'Target','target-user');
  targetProfile.JumpHost=gatewayProfile.Id;
  const known=new Map(),events=[],checked=new Set();
  const win={isDestroyed:()=>false,webContents:{send(_event,item){
    events.push(item);
    if(item.type==='verify'){
      checked.add(item.host+':'+item.port);
      setImmediate(()=>links.acceptHost(item.requestId,true));
    }
  }}};
  const store={
    config:{Sessions:[gatewayProfile,targetProfile],Credentials:[]},
    passwordForHost:h=>h.Id==='jump'?'gateway-secret':'target-secret',
    lookupFingerprint:(host,port)=>known.get(host+':'+port)||null,
    trustFingerprint:(host,port,hash)=>known.set(host+':'+port,{hash})
  };
  const links=new Connections(win,store);
  const sessionId=crypto.randomUUID();
  try{
    await links.connect({id:'destination',sessionId});
    await until(events,e=>e.type==='status'&&e.status==='shell-ready');
    assert.equal(target.shellCount,1);
    assert.equal(forwarded,1);
    assert.equal(known.size,2,'Both SSH server fingerprints must be stored separately');
    assert.equal(checked.size,2,'Each server must display its own trust prompt');
    links.write(sessionId,'jump-echo\n');
    await until(events,e=>e.type==='data'&&e.data.includes('jump-echo'));
    assert.equal(links.sessions.get(sessionId).gateway!==null,true);
    links.disconnect(sessionId);
    await until(events,e=>e.type==='status'&&e.status==='closed');
    assert.equal(links.sessions.has(sessionId),false);
    targetProfile.Protocol='SFTP';
    const sftpSession=crypto.randomUUID();
    await links.connect({id:'destination',sessionId:sftpSession});
    await until(events,e=>e.sessionId===sftpSession&&
      e.type==='status'&&e.status==='sftp-ready');
    assert.equal(forwarded,2);
    assert.equal(target.shellCount,1,'SFTP-only connection must not open a shell');
    assert.equal(checked.size,2,'Trusted host keys should not prompt again');
    links.disconnect(sftpSession);
    await until(events,e=>e.sessionId===sftpSession&&
      e.type==='status'&&e.status==='closed');
  }finally{
    links.closeAll();
    for(const socket of sockets)socket.destroy();
    for(const connection of jumpServers)connection.end();
    await new Promise(resolve=>gatewayServer.close(resolve));
    await target.close();
  }
});
test('invalid jump references and chaining are refused before any network connection',async()=>{
  const a=profile('a',22,'A','tester'),b=profile('b',22,'B','tester');
  const store={
    config:{Sessions:[a,b],Credentials:[]},
    passwordForHost:()=>'',lookupFingerprint:()=>null
  };
  const win={isDestroyed:()=>false,webContents:{send(){}}};
  const links=new Connections(win,store);
  a.JumpHost='missing';
  await assert.rejects(links.connect({id:'a'}),/saved SSH hosts/);
  a.JumpHost='a';
  await assert.rejects(links.connect({id:'a'}),/itself/);
  a.JumpHost='b';b.JumpHost='a';
  await assert.rejects(links.connect({id:'a'}),/Chained/);
  assert.equal(links.sessions.size,0);
});

test('gateway authentication failure closes target session cleanly', {timeout:11000},async()=>{
  const jump=await launchServer(keypair(),'gateway-user','correct-password');
  const gateway=profile('jump-fail',jump.port,'Gateway','gateway-user');
  const destination=profile('target-fail',2222,'Target','target-user');
  destination.JumpHost=gateway.Id;
  const events=[];
  const win={isDestroyed:()=>false,webContents:{send(_event,item){
    events.push(item);
    if(item.type==='verify')setImmediate(()=>connections.acceptHost(item.requestId,true));
  }}};
  const store={
    config:{Sessions:[gateway,destination],Credentials:[]},
    passwordForHost:host=>host.Id==='jump-fail'?'wrong-password':'target-secret',
    lookupFingerprint:()=>null,trustFingerprint:()=>{}
  };
  const connections=new Connections(win,store);
  try{
    await connections.connect({id:destination.Id});
    await until(events,e=>e.type==='error',6500);
    await until(events,e=>e.type==='status'&&e.status==='closed',6500);
    assert.equal(connections.sessions.size,0);
  }finally{
    connections.closeAll();
    await jump.close();
  }
});
