'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const https=require('node:https');
const tls=require('node:tls');
const {X509Certificate}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {ServerCertificates,parseCertificates}=require('../electron/sync-tls.cjs');
const {SyncClient}=require('../electron/sync.cjs');

test('custom HTTPS trust is persistent, scoped to an origin and cannot bypass certificate checks',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shiroterm-tls-'));
  const openssl=process.platform==='win32'&&fs.existsSync('C:\\Program Files\\Git\\usr\\bin\\openssl.exe')?
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe':'openssl';
  const servers=[];
  const oldCA=process.env.SHIROTERM_SYNC_CA;delete process.env.SHIROTERM_SYNC_CA;
  function certificate(name,san='IP:127.0.0.1'){
    const key=path.join(dir,name+'.key'),cert=path.join(dir,name+'.pem');
    execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','2',
      '-subj','/CN=ShiroTerm TLS fixture '+name,'-addext','basicConstraints=critical,CA:TRUE',
      '-addext','subjectAltName='+san,'-keyout',key,'-out',cert],
      {stdio:'pipe',env:{...process.env,MSYS_NO_PATHCONV:'1'}});
    return {key:fs.readFileSync(key),cert:fs.readFileSync(cert)};
  }
  async function serve(credentials){
    const requests=[];
    const server=https.createServer(credentials,(req,res)=>{
      requests.push({url:req.url,authorization:req.headers.authorization});
      res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');
    });
    server.on('tlsClientError',()=>{});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);
    return {url:'https://127.0.0.1:'+server.address().port,requests};
  }
  try{
    const first=certificate('first'),second=certificate('second'),wrongHost=certificate('wrong-host','DNS:example.invalid');
    const a=await serve(first),b=await serve(second),c=await serve(wrongHost);
    const client=new SyncClient({dir});client.endpoint=a.url;client.token='fixture-only-device-token';
    await assert.rejects(client.request('GET','/probe'),/Nieufny certyfikat HTTPS/);
    assert.equal(a.requests.length,0,'Untrusted TLS must not receive an authorization token');
    await client.certificates.verify(a.url,first.cert);
    assert.equal(a.requests.length,0,'Certificate validation must not issue an HTTP request');
    const saved=client.certificates.set(a.url,first.cert);
    assert.equal(saved.fingerprint,new X509Certificate(first.cert).fingerprint256);
    assert.deepEqual(await client.request('GET','/probe'),{ok:true});
    assert.equal(a.requests[0].authorization,'Bearer fixture-only-device-token');
    const restarted=new SyncClient({dir});restarted.endpoint=a.url;
    assert.deepEqual(await restarted.request('GET','/probe'),{ok:true});
    restarted.endpoint=b.url;
    await assert.rejects(restarted.request('GET','/probe'),/Nieufny certyfikat HTTPS/);
    assert.equal(b.requests.length,0,'Trust must not leak to another port/origin');
    await assert.rejects(client.certificates.verify(a.url,second.cert),/Nieufny certyfikat HTTPS/,
      'A candidate must verify by itself even if another certificate already works');
    client.certificates.set(c.url,wrongHost.cert);client.endpoint=c.url;
    await assert.rejects(client.request('GET','/probe'),/Adres serwera nie zgadza/);
    assert.equal(c.requests.length,0);
    const roots=client.certificates.options(a.url).ca;
    assert.equal(client.certificates.options(a.url).rejectUnauthorized,true);
    assert.ok(roots.includes(tls.rootCertificates[0]),'Custom trust must preserve public trust roots');
    const before=fs.readFileSync(client.certificates.file,'utf8');
    assert.throws(()=>client.certificates.set(a.url,'not a certificate'),/odczytać certyfikatu/);
    assert.throws(()=>client.certificates.set(a.url,Buffer.concat([first.cert,first.key])),/klucza prywatnego/);
    assert.equal(fs.readFileSync(client.certificates.file,'utf8'),before);
    const cert=new X509Certificate(first.cert);
    assert.equal(parseCertificates(cert.raw)[0],cert.toString(),'DER certificates are accepted');
    const realNow=Date.now;
    try{Date.now=()=>Date.parse(cert.validTo)+1000;assert.throws(()=>parseCertificates(first.cert),/wygasł/);}
    finally{Date.now=realNow;}
    client.certificates.remove(a.url);
    assert.equal(new ServerCertificates(dir).info(a.url),null);
    client.endpoint=a.url;
    await assert.rejects(client.request('GET','/probe'),/Nieufny certyfikat HTTPS/);
  }finally{
    if(oldCA===undefined)delete process.env.SHIROTERM_SYNC_CA;else process.env.SHIROTERM_SYNC_CA=oldCA;
    for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
