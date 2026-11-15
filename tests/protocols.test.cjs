'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {EventEmitter}=require('node:events');
const {endpoint,launch,checkReachability}=require('../electron/rdp.cjs');
const {TelnetConnections,filterTelnet,IAC,WILL,DO,DONT,SB,SE}=require('../electron/telnet.cjs');

test('RDP forms a safe Windows endpoint with default and custom ports',()=>{
  assert.equal(endpoint({Protocol:'RDP',Host:'server.example',Port:3389}),'server.example');
  assert.equal(endpoint({Protocol:'RDP',Host:'192.168.1.9',Port:3391}),'192.168.1.9:3391');
  assert.equal(endpoint({Protocol:'RDP',Host:'::1',Port:3389}),'[::1]');
  assert.equal(endpoint({Protocol:'RDP',Host:'[::1]',Port:3389}),'[::1]');
  assert.throws(()=>endpoint({Protocol:'RDP',Host:'a;calc',Port:3389}));
  assert.throws(()=>endpoint({Protocol:'RDP',Host:'host\nname',Port:3389}));
  assert.throws(()=>endpoint({Protocol:'RDP',Host:'/v:malicious',Port:3389}));
  assert.throws(()=>endpoint({Protocol:'RDP',Host:'host',Port:90000}));
  assert.throws(()=>endpoint({Protocol:'SSH',Host:'host',Port:3389}));
});
test('RDP checks the target TCP port before attempting Windows sign-in',async()=>{
  const server=net.createServer(socket=>socket.end());
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const profile={Protocol:'RDP',Host:'127.0.0.1',Port:server.address().port};
  try{
    assert.equal((await checkReachability(profile)).port,profile.Port);
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
  await assert.rejects(()=>checkReachability(profile),/connection refused/);
  const fakeDial=()=>{
    const socket=new EventEmitter();
    socket.destroy=()=>{};
    socket.setTimeout=(_ms,callback)=>{queueMicrotask(callback);};
    return socket;
  };
  await assert.rejects(()=>checkReachability(profile,{dial:fakeDial,timeoutMs:10}),
    /connection timed out/);
});
test('RDP launches real Windows mstsc.exe without a shell or credential arguments',async()=>{
  let invoked;
  const run=(binary,args,options)=>{
    invoked={binary,args,options};
    const child=new EventEmitter();
    child.pid=1234;
    queueMicrotask(()=>child.emit('spawn'));
    return child;
  };
  const opened=await launch({Protocol:'RDP',Host:'192.0.2.215',Port:3391,User:'root',Password:'not-exported'},
    {platform:'win32',windowsDir:'C:\\Windows',run});
  assert.equal(opened.address,'192.0.2.215:3391');
  assert.equal(opened.external,true);
  assert.match(invoked.binary,/System32[\\/]mstsc\.exe$/);
  assert.deepEqual(invoked.args,['/v:192.0.2.215:3391','/prompt']);
  assert.equal(invoked.options.shell,false);
  assert.ok(!JSON.stringify(invoked).includes('not-exported'));
  await assert.rejects(()=>launch({Protocol:'RDP',Host:'ok',Port:3389},{platform:'darwin',run}),
    /supported on Windows and Linux/);
});

test('Linux RDP launches graphical Remmina without credentials or a shell',async()=>{
  let invoked;
  const run=(binary,args,options)=>{
    invoked={binary,args,options};
    const child=new EventEmitter();
    queueMicrotask(()=>child.emit('spawn'));
    return child;
  };
  const result=await launch({Protocol:'RDP',Host:'::1',Port:3391,Password:'never-passed'},
    {platform:'linux',run});
  assert.equal(result.client,'Remmina');
  assert.deepEqual(invoked.args,['--connect','rdp://[::1]:3391']);
  assert.equal(invoked.binary,'remmina');
  assert.equal(invoked.options.shell,false);
  assert.ok(!JSON.stringify(invoked).includes('never-passed'));
  await assert.rejects(()=>launch({Protocol:'RDP',Host:'example.test'},
    {platform:'linux',run:()=>{
      const child=new EventEmitter();
      queueMicrotask(()=>child.emit('error',Object.assign(new Error('missing'),{code:'ENOENT'})));
      return child;
    }}),/Install Remmina/);
});
test('RDP reports Windows launcher errors without claiming a successful connection',async()=>{
  const run=()=>{
    const child=new EventEmitter();
    queueMicrotask(()=>child.emit('error',Object.assign(new Error('mstsc.exe not found'),{code:'ENOENT'})));
    return child;
  };
  await assert.rejects(()=>launch({Protocol:'RDP',Host:'server',Port:3389},
    {platform:'win32',windowsDir:'C:\\Windows',run}),/could not start/);
});
test('Telnet strips IAC negotiation, supports split commands and escaped 255',()=>{
  const sent=[];
  const state={phase:'data',command:0};
  assert.equal(filterTelnet(state,Buffer.from([65,IAC,WILL]),b=>sent.push([...b])).toString(),'A');
  assert.equal(filterTelnet(state,Buffer.from([1,66,IAC,SB,24,1,IAC]),b=>sent.push([...b])).toString(),'B');
  assert.equal(filterTelnet(state,Buffer.from([SE,67,IAC,IAC]),b=>sent.push([...b])).toString('latin1'),
    'C\u00ff');
  assert.deepEqual(sent,[[IAC,DO,1]]);
  const second=[];
  filterTelnet({phase:'data',command:0},Buffer.from([IAC,WILL,99]),b=>second.push([...b]));
  assert.deepEqual(second,[[IAC,DONT,99]]);
});
test('loopback Telnet session exchanges traffic and cleans up without SSH credentials',async()=>{
  let wire='';
  const server=net.createServer(socket=>{
    socket.write(Buffer.from([IAC,WILL,1]));
    socket.write('Welcome to test telnet!\r\n');
    socket.on('data',b=>{
      wire+=b.toString('binary');
      if(wire.includes('status\r\n'))socket.write('OK\r\n');
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const events=[];
  const win={isDestroyed:()=>false,webContents:{send(name,payload){events.push(payload);}}};
  const store={config:{Sessions:[{Id:'t1',Name:'Telnet fixture',Host:'127.0.0.1',Port:port,Protocol:'TELNET',User:''}]}};
  const client=new TelnetConnections(win,store);
  const wait=async predicate=>{
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){
      if(events.some(predicate))return;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw Error('Timed out waiting for event: '+JSON.stringify(events.slice(-5)));
  };
  try{
    client.connect({id:'t1',sessionId:'session1'});
    await wait(e=>e.type==='status'&&e.status==='shell-ready');
    await wait(e=>e.type==='data'&&e.data.includes('Welcome'));
    client.write('session1','status\r');
    await wait(e=>e.type==='data'&&e.data.includes('OK'));
    assert.equal(wire.includes('status\r\n'),true);
    assert.equal(events.some(e=>e.type==='data'&&e.data.includes('\u00ff')),false,
      'IAC protocol bytes must never render in terminal');
    assert.equal(client.disconnect('session1'),true);
    await wait(e=>e.status==='closed');
    assert.equal(client.sessions.size,0);
  }finally{
    client.closeAll();
    await new Promise(resolve=>server.close(resolve));
  }
});
