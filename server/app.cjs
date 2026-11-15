'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const https=require('node:https');
const {Database}=require('./lib/database.cjs');
const {Auth,RateLimit,username,passwordHash,hash}=require('./lib/auth.cjs');
const {Vaultwarden}=require('./lib/vaultwarden.cjs');
const {HttpError,fail}=require('./lib/errors.cjs');
const {version}=require('./package.json');
const staticFiles=new Map([
  ['/console',['index.html','text/html; charset=utf-8']],
  ['/console/app.js',['app.js','application/javascript; charset=utf-8']],
  ['/console/styles.css',['styles.css','text/css; charset=utf-8']]
]);
function json(res,status,payload,headers={}){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),...headers});
  res.end(body);
}
function readBody(req,max){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))fail(415,'Send application/json');
  if(Number(req.headers['content-length'])>max){req.resume();fail(413,'Request body is too large');}
  return new Promise((resolve,reject)=>{
    const parts=[];let size=0,failed=false;
    req.on('data',chunk=>{
      size+=chunk.length;
      if(size>max){if(!failed){failed=true;reject(new HttpError(413,'Request body is too large'));}return;}
      if(!failed)parts.push(chunk);
    });
    req.once('error',()=>reject(new HttpError(400,'Incomplete request body')));
    req.once('end',()=>{
      if(failed)return;
      try{
        const value=JSON.parse(Buffer.concat(parts).toString('utf8'));
        if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
        resolve(value);
      }catch{reject(new HttpError(400,'Invalid JSON request'));}
    });
  });
}
async function createService({config,tls,now=()=>Math.floor(Date.now()/1000),vaultFactory}={}){
  const db=new Database(config.dataDir,{historyLimit:config.historyLimit,now});
  const auth=new Auth(db,config),limits=new RateLimit(()=>now()*1000);
  const vault=vaultFactory?vaultFactory(config,{now}):new Vaultwarden(config,{now});
  try{
    if(!db.get('SELECT COUNT(*) AS count FROM users').count){
      if(!config.adminPasswordFile)throw Error('First startup requires ADMIN_PASSWORD_FILE. Run the setup helper first.');
      const password=fs.readFileSync(config.adminPasswordFile,'utf8').replace(/\r?\n$/,'');
      db.createUser(username(config.adminUser),await passwordHash(password),true);
    }
  }catch(error){db.close();throw error;}
  const respond=async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if(config.publicUrl.startsWith('https:'))res.setHeader('Strict-Transport-Security','max-age=31536000');
    try{
      if(!req.url||req.url.length>2048)fail(414,'Request URL is too long');
      const url=new URL(req.url,config.publicUrl),route=url.pathname,method=req.method;
      if(route==='/healthz'&&method==='GET')return json(res,200,{status:'ok',version});
      limits.take('global:'+req.socket.remoteAddress,2400,60000);
      if(route==='/'&&method==='GET'){res.writeHead(302,{Location:'/console'});res.end();return;}
      const asset=staticFiles.get(route);
      if(asset&&method==='GET'){
        const body=fs.readFileSync(path.join(__dirname,'public',asset[0]));
        res.writeHead(200,{'Content-Type':asset[1],'Content-Length':body.length});res.end(body);return;
      }
      const body=()=>readBody(req,route.includes('snapshot')?config.maxBody:32768);
      const limited=key=>limits.take(key+':'+req.socket.remoteAddress,20,10*60000);
      if(route==='/console/api/login'&&method==='POST'){
        auth.origin(req);limited('login');
        const user=await auth.credentials(await body());
        const session=auth.issue(user.username,'browser','Server console');
        return json(res,200,{authenticated:true,user:user.username,admin:!!user.admin,csrf:session.csrf},
          {'Set-Cookie':auth.cookie(session.token,config.browserHours*3600)});
      }
      if(route==='/console/api/session'&&method==='GET'){
        try{
          const session=auth.authenticate(req,{browserOnly:true});
          return json(res,200,{authenticated:true,user:session.username,admin:!!session.admin,csrf:session.csrf});
        }catch(error){if(error.status===401)return json(res,200,{authenticated:false});throw error;}
      }
      if(route==='/v1/device/start'&&method==='POST'){
        limited('pair-start');return json(res,201,auth.startPairing(await body()));
      }
      if(route==='/v1/device/poll'&&method==='POST'){
        limits.take('pair-poll:'+req.socket.remoteAddress,360,60000);
        return json(res,200,auth.poll(await body()));
      }
      if(route==='/v1/auth/login'&&method==='POST'){
        limited('login');const user=await auth.credentials(await body());
        const {csrf,...issued}=auth.issue(user.username,'device');return json(res,200,issued);
      }
      if(route.startsWith('/console/api/')){
        const session=auth.authenticate(req,{browserOnly:true}),user=session.username;
        if(method!=='GET')auth.csrf(req,session);
        limits.take('console:'+session.hash,120,60000);
        if(route==='/console/api/logout'&&method==='POST'){
          db.run('DELETE FROM sessions WHERE hash=?',session.hash);
          return json(res,200,{signedOut:true},{'Set-Cookie':auth.cookie('',0)});
        }
        if(route==='/console/api/pairing'&&method==='GET'){
          const pending=auth.pairing(url.searchParams.get('code'));
          return json(res,200,{label:pending.label,expiresIn:pending.expires-now(),approved:!!pending.approved_user});
        }
        if(route==='/console/api/device/approve'&&method==='POST')
          return json(res,200,auth.approve(user,(await body()).code));
        if(route==='/console/api/devices'&&method==='GET')
          return json(res,200,{devices:db.all('SELECT hash AS id,label,created,expires FROM sessions WHERE username=? AND kind=? AND expires>? ORDER BY created DESC',user,'device',now())});
        if(route==='/console/api/device/revoke'&&method==='POST'){
          const id=(await body()).id;
          if(!/^[a-f0-9]{64}$/.test(id||''))fail(400,'Invalid device identifier');
          db.run('DELETE FROM sessions WHERE hash=? AND username=? AND kind=?',id,user,'device');
          return json(res,200,{revoked:true});
        }
        if(route==='/console/api/password'&&method==='POST'){
          limited('password');const input=await body();
          await auth.credentials({username:user,password:input.currentPassword});
          const password=await passwordHash(input.newPassword);
          db.transaction(()=>{
            db.run('UPDATE users SET password=? WHERE username=?',password,user);
            db.run('DELETE FROM sessions WHERE username=? AND hash<>?',user,session.hash);
            db.run('DELETE FROM pairings WHERE approved_user=?',user);
          });
          if(vault.status(user).connected)await vault.disconnect(user);
          return json(res,200,{changed:true});
        }
        if(route==='/console/api/vault/status'&&method==='GET')return json(res,200,vault.status(user));
        if(route==='/console/api/vault/connect'&&method==='POST'){
          limited('vault-connect');return json(res,200,await vault.connect(user,await body()));
        }
        if(route==='/console/api/vault/disconnect'&&method==='POST')return json(res,200,await vault.disconnect(user));
        if(route==='/console/api/users'&&session.admin){
          if(method==='GET')return json(res,200,{users:db.all('SELECT username,admin,enabled,created FROM users ORDER BY username')});
          if(method==='POST'){
            limited('user-create');const input=await body();
            const name=username(input.username),password=await passwordHash(input.password);
            db.createUser(name,password,input.admin===true);return json(res,201,{username:name});
          }
        }
        if(route==='/console/api/user/disable'&&method==='POST'&&session.admin){
          const name=username((await body()).username);
          if(name===user)fail(400,'You cannot disable your own account');
          if(!db.get('SELECT username FROM users WHERE username=?',name))fail(404,'User not found');
          db.transaction(()=>{
            db.run('UPDATE users SET enabled=0 WHERE username=?',name);
            db.run('DELETE FROM sessions WHERE username=?',name);
            db.run('DELETE FROM pairings WHERE approved_user=?',name);
          });
          if(vault.status(name).connected)await vault.disconnect(name);
          return json(res,200,{disabled:true});
        }
        if(route==='/console/api/user/enable'&&method==='POST'&&session.admin){
          const name=username((await body()).username);
          if(!db.get('SELECT username FROM users WHERE username=?',name))fail(404,'User not found');
          db.run('UPDATE users SET enabled=1 WHERE username=?',name);
          return json(res,200,{enabled:true});
        }
        fail(404,'Endpoint not found or access denied');
      }
      if(!route.startsWith('/v1/'))fail(404,'Not found');
      const session=auth.authenticate(req),user=session.username;
      if(session.kind==='browser'&&method!=='GET')auth.csrf(req,session);
      limits.take('device:'+session.hash,300,60000);
      if(route==='/v1/auth/logout'&&method==='POST'){
        await body();db.run('DELETE FROM sessions WHERE hash=?',session.hash);return json(res,200,{signedOut:true});
      }
      if(route==='/v1/profile-vaults'){
        if(method==='GET')return json(res,200,db.listVaults(user));
        if(method==='POST')return json(res,201,db.createVault(user,(await body()).name));
      }
      const snapshot=route.match(/^\/v1\/(?:profile-vaults\/([a-f0-9]{32})\/)?(snapshot|history)(?:\/(\d{1,10}))?$/);
      if(snapshot){
        const id=snapshot[1]||'personal';
        if(snapshot[2]==='snapshot'&&!snapshot[3]){
          if(method==='GET')return json(res,200,db.snapshot(user,id));
          if(method==='PUT')return json(res,200,db.saveSnapshot(user,id,await body()));
        }
        if(snapshot[2]==='history'&&method==='GET')
          return json(res,200,db.history(user,id,snapshot[3]===undefined?undefined:Number(snapshot[3])));
      }
      if(route==='/v1/vault/status'&&method==='GET')return json(res,200,vault.status(user));
      if(route==='/v1/vault/items'&&method==='GET')return json(res,200,await vault.items(user));
      if(method==='POST'){
        if(route==='/v1/vault/sync'){await body();return json(res,200,await vault.refresh(user));}
        if(route==='/v1/vault/disconnect'){await body();return json(res,200,await vault.disconnect(user));}
        if(route==='/v1/vault/password')return json(res,200,await vault.password(user,(await body()).itemId));
        if(route==='/v1/vault/item/create')return json(res,201,await vault.write(user,await body()));
        if(route==='/v1/vault/item/update')return json(res,200,await vault.write(user,await body(),true));
      }
      fail(404,'Endpoint not found');
    }catch(error){
      if(res.headersSent){res.end();return;}
      const status=Number.isInteger(error.status)&&error.status>=400&&error.status<600?error.status:500;
      if(status===500)console.error(JSON.stringify({event:'request_failed',method:req.method,status}));
      // Drain rejected bodies without prematurely resetting an uploading client.
      return json(res,status,{error:status===500?'Internal server error':error.message},
        status===429?{'Retry-After':'60'}:{});
    }
  };
  const server=tls?https.createServer(tls,respond):http.createServer(respond);
  server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
  server.maxRequestsPerSocket=1000;
  const maintenance=setInterval(()=>{
    db.cleanup();for(const user of vault.sessions?.keys?.()||[])vault.active(user);
  },60000);
  maintenance.unref();
  return {server,db,auth,vault,async close(){
    clearInterval(maintenance);
    await new Promise(resolve=>{server.close(()=>resolve());server.closeIdleConnections?.();});
    vault.close();db.close();
  }};
}
module.exports={createService,readBody};
