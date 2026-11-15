'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {loadPrivateKey}=require('../electron/ssh-auth.cjs');

test('unencrypted and encrypted SSH keys require the proper passphrase',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'shiroterm-auth-'));
  try{
    const plain=crypto.generateKeyPairSync('rsa',{
      modulusLength:2048,
      privateKeyEncoding:{type:'pkcs1',format:'pem'},
      publicKeyEncoding:{type:'spki',format:'pem'}
    }).privateKey;
    const encrypted=crypto.generateKeyPairSync('rsa',{
      modulusLength:2048,
      privateKeyEncoding:{type:'pkcs1',format:'pem',cipher:'aes-256-cbc',
        passphrase:'test-key-passphrase'},
      publicKeyEncoding:{type:'spki',format:'pem'}
    }).privateKey;
    const clearFile=path.join(root,'clear.pem');
    const secretFile=path.join(root,'encrypted.pem');
    fs.writeFileSync(clearFile,plain);
    fs.writeFileSync(secretFile,encrypted);
    assert.ok(loadPrivateKey(clearFile).privateKey);
    assert.throws(()=>loadPrivateKey(secretFile),/passphrase|encrypted/i);
    assert.throws(()=>loadPrivateKey(secretFile,'wrong'),/passphrase|encrypted/i);
    const correct=loadPrivateKey(secretFile,'test-key-passphrase');
    assert.equal(correct.passphrase,'test-key-passphrase');
    assert.ok(correct.privateKey.equals(Buffer.from(encrypted)));
    assert.throws(()=>loadPrivateKey('vault:old'),/reimport|valid/i);
    const invalid=path.join(root,'bad.pem');
    fs.writeFileSync(invalid,'This is not a private key!');
    assert.throws(()=>loadPrivateKey(invalid),/invalid|Unable|size/i);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('encrypted private key authenticates to a local SSH server using session-only passphrase',
{timeout:12000},async()=>{
  const {Server}=require('ssh2');
  const {Connections}=require('../electron/ssh.cjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'shiroterm-ssh-pubkey-'));
  const hostKeys=crypto.generateKeyPairSync('rsa',{
    modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},
    publicKeyEncoding:{type:'spki',format:'pem'}
  });
  const key=crypto.generateKeyPairSync('rsa',{
    modulusLength:2048,
    privateKeyEncoding:{type:'pkcs1',format:'pem',cipher:'aes-256-cbc',
      passphrase:'ephemeral-passphrase'},
    publicKeyEncoding:{type:'spki',format:'pem'}
  });
  const keyPath=path.join(root,'client.pem');
  fs.writeFileSync(keyPath,key.privateKey);
  const accepted=[];
  const server=new Server({hostKeys:[hostKeys.privateKey]},client=>{
    client.on('authentication',ctx=>{
      if(ctx.method==='publickey'&&ctx.username==='key-user'){
        accepted.push(ctx.method);
        ctx.accept();
      }else ctx.reject();
    });
    client.on('ready',()=>client.on('session',accept=>{
      const s=accept();
      s.on('pty',accept=>accept?.());
      s.on('shell',accept=>accept().write('key-auth-accepted\n'));
    }));
  });
  const events=[];
  const win={isDestroyed:()=>false,webContents:{send(_channel,event){
    events.push(event);
    if(event.type==='verify')
      setImmediate(()=>sessions.acceptHost(event.requestId,true));
  }}};
  const store={
    config:{Sessions:[],Credentials:[]},
    passwordForHost:()=>'',lookupFingerprint:()=>null,trustFingerprint:()=>{}
  };
  const sessions=new Connections(win,store);
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    store.config.Sessions.push({
      Id:'ssh-key',Name:'Key Test',Host:'127.0.0.1',Port:server.address().port,
      User:'key-user',Protocol:'SSH',KeyFile:keyPath,CredentialId:'',
      JumpHost:'',SshKeepAliveSeconds:30
    });
    await assert.rejects(sessions.connect({id:'ssh-key',keyPassphrase:'wrong'}),/passphrase/i);
    assert.equal(sessions.sessions.size,0,'Bad passphrase must not create a session');
    const session=await sessions.connect({id:'ssh-key',keyPassphrase:'ephemeral-passphrase'});
    const deadline=Date.now()+4500;
    while(!events.some(e=>e.sessionId===session.sessionId&&e.type==='status'&&e.status==='shell-ready')){
      if(Date.now()>deadline)throw new Error('Key auth timed out: '+JSON.stringify(events));
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.ok(accepted.length>=1);
  }finally{
    sessions.closeAll();
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
