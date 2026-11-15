'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {EventEmitter}=require('node:events');
const {LocalForwarding,port,targetName}=require('../electron/forwarding.cjs');

test('forwarding validates port ranges and target names',()=>{
  assert.equal(port(8080),8080);
  for(const invalid of [-1,0,1.5,65536,'not-a-port']){
    assert.throws(()=>port(invalid));
  }
  assert.equal(targetName('localhost'),'localhost');
  assert.throws(()=>targetName('bad host'));
  assert.throws(()=>targetName('some/path'));
});
test('rejects forwarding on a disconnected SSH session',async()=>{
  const manager=new LocalForwarding(()=>null);
  await assert.rejects(manager.start({sessionId:'abc',listenPort:9000,
    targetHost:'localhost',targetPort:443}),/ready/);
});
test('local port binds to loopback and relays bytes through SSH channel',async()=>{
  const echo=net.createServer(s=>s.pipe(s));
  await new Promise(r=>echo.listen(0,'127.0.0.1',r));
  const dst=echo.address().port;
  const client=new EventEmitter();
  client.forwardOut=(_from,_fromPort,_host,toPort,cb)=>{
    const remote=net.connect(toPort,'127.0.0.1');
    remote.once('connect',()=>cb(null,remote));
    remote.once('error',cb);
  };
  const manager=new LocalForwarding(()=>({client,ready:true,closing:false}));
  const reservation=net.createServer();
  await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
  const listenPort=reservation.address().port;
  await new Promise(r=>reservation.close(r));
  try{
    const rule=await manager.start({sessionId:'ssh-1',listenPort,
      targetHost:'localhost',targetPort:dst});
    assert.equal(manager.list().length,1);
    const reply=await new Promise((resolve,reject)=>{
      const socket=net.connect(listenPort,'127.0.0.1');
      socket.setTimeout(2500,()=>reject(new Error('Test timeout')));
      socket.once('connect',()=>socket.write('shiro-echo'));
      socket.once('data',buffer=>{socket.destroy();resolve(buffer.toString());});
      socket.once('error',reject);
    });
    assert.equal(reply,'shiro-echo');
    assert.equal(manager.stop(rule.id),true);
    assert.equal(manager.list().length,0);
  }finally{
    manager.stopAll();
    await new Promise(r=>echo.close(r));
  }
});
