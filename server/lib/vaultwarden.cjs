'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {fail,text}=require('./errors.cjs');
const itemId=value=>{
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value||''))
    fail(400,'Invalid Vaultwarden item identifier');
  return value;
};
const metadata=item=>({id:item.id,name:item.name||'',username:item.login?.username||'',
  revisionDate:item.revisionDate||'',organization:!!item.organizationId});
class Vaultwarden {
  constructor(config,{run=spawn,now=()=>Math.floor(Date.now()/1000)}={}){
    this.config=config;this.run=run;this.now=now;
    this.available=!!config.vaultUrl&&(run!==spawn||fs.existsSync(config.bwPath));
    this.sessions=new Map();this.busy=new Set();
  }
  active(user){
    const session=this.sessions.get(user);
    if(session&&session.expires<=this.now()){this.sessions.delete(user);return null;}
    return session||null;
  }
  status(user){
    const session=this.active(user);
    return {configured:this.available,connected:!!session,server:this.config.vaultUrl,
      account:session?.email||'',lastSync:session?.lastSync||0,lastAttempt:session?.lastAttempt||0,
      lastError:session?.lastError||'',expiresInSeconds:session?session.expires-this.now():0,
      itemCount:session?.items.length||0,syncIntervalSeconds:300};
  }
  async locked(user,task){
    if(!this.available)fail(503,'Vaultwarden is not configured on this server');
    if(this.busy.has(user))fail(409,'A Vaultwarden operation is already running. Try again shortly.');
    this.busy.add(user);
    try{return await task();}finally{this.busy.delete(user);}
  }
  require(user){const session=this.active(user);if(!session)fail(423,'Unlock Vaultwarden in the server console first');return session;}
  command(user,args,{password='',session='',stdin='',timeout=12000}={}){
    const dir=path.join(this.config.dataDir,'bitwarden',user);
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    return new Promise((resolve,reject)=>{
      let child,done=false,size=0,out=[];
      const complete=(error,result)=>{
        if(done)return;done=true;clearTimeout(timer);
        if(error)reject(error);else resolve(result);
      };
      const timer=setTimeout(()=>{
        child?.kill('SIGKILL');complete(Object.assign(Error('Vaultwarden operation timed out'),{status:504}));
      },timeout);
      try{
        child=this.run(this.config.bwPath,[...args,'--nointeraction'],{
          shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],
          env:{...process.env,BITWARDENCLI_APPDATA_DIR:dir,BW_SESSION:session,
            SHIROTERM_VAULT_PASSWORD:password,BW_NOINTERACTION:'true',
            BW_CLIENTID:'',BW_CLIENTSECRET:''}
        });
        child.on('error',()=>complete(Object.assign(Error('Vaultwarden CLI could not start'),{status:503})));
        child.stdout.on('data',chunk=>{
          size+=chunk.length;
          if(size>8*1024*1024){child.kill('SIGKILL');complete(Object.assign(Error('Vaultwarden response too large'),{status:502}));}
          else out.push(chunk);
        });
        // Never log CLI output: errors may contain account or vault information.
        child.stderr.on('data',()=>{});
        child.stdin.on('error',()=>{});
        child.once('close',code=>complete(code?Object.assign(Error('Vaultwarden operation failed. Check your credentials, MFA code and server availability.'),{status:502}):null,
          Buffer.concat(out).toString('utf8').trim()));
        child.stdin.end(stdin);
      }catch{complete(Object.assign(Error('Vaultwarden CLI could not start'),{status:503}));}
    });
  }
  json(value){try{return JSON.parse(value);}catch{fail(502,'Invalid Vaultwarden CLI response');}}
  async connect(user,input){
    return this.locked(user,async()=>{
      const email=text(typeof input?.email==='string'?input.email.trim():input?.email,3,254,'Vaultwarden email');
      const password=text(input?.password,1,1024,'Vaultwarden master password');
      const code=input?.code?text(input.code,6,12,'two-factor code'):'';
      if(code&&!/^[0-9]+$/.test(code))fail(400,'Use an authenticator (TOTP) code');
      this.sessions.delete(user);
      // Each ShiroTerm account has a separate encrypted CLI cache and session.
      try{await this.command(user,['logout']);}catch{}
      await this.command(user,['config','server',this.config.vaultUrl]);
      const key=await this.command(user,['login',email,'--passwordenv','SHIROTERM_VAULT_PASSWORD','--raw',
        ...(code?['--method','0','--code',code]:[])],{password,timeout:45000});
      if(!/^[A-Za-z0-9+/=_-]{32,256}$/.test(key))fail(502,'Vaultwarden did not return an unlocked session');
      this.sessions.set(user,{email,key,expires:this.now()+this.config.vaultMinutes*60,
        lastSync:0,lastAttempt:0,lastError:'',items:[]});
      try{await this.refreshUnlocked(user);}catch(error){this.sessions.delete(user);throw error;}
      return this.status(user);
    });
  }
  async refreshUnlocked(user){
    const session=this.require(user);session.lastAttempt=this.now();
    try{
      await this.command(user,['sync'],{session:session.key});
      const items=this.json(await this.command(user,['list','items'],{session:session.key}));
      if(!Array.isArray(items))fail(502,'Invalid Vaultwarden item list');
      session.items=items.filter(item=>item.type===1&&!item.deletedDate).map(metadata);
      session.lastSync=this.now();session.lastError='';return this.status(user);
    }catch(error){session.lastError='Vaultwarden refresh failed';throw error;}
  }
  refresh(user){return this.locked(user,()=>this.refreshUnlocked(user));}
  items(user){return this.locked(user,async()=>{
    const session=this.require(user);
    if(this.now()-session.lastSync>=300)await this.refreshUnlocked(user);
    return {items:session.items};
  });}
  password(user,id){return this.locked(user,async()=>{
    const session=this.require(user);
    const item=this.json(await this.command(user,['get','item',itemId(id)],{session:session.key}));
    if(item.type!==1||item.deletedDate)fail(404,'Login item not found');
    return {password:item.login?.password||''};
  });}
  write(user,input,update=false){return this.locked(user,async()=>{
    const session=this.require(user);
    const name=text(typeof input?.name==='string'?input.name.trim():input?.name,1,128,'item name');
    const loginUser=text(input?.username,1,128,'login username');
    const password=text(input?.password,1,4096,'login password');
    let item={type:1,name,notes:null,favorite:false,organizationId:null,collectionIds:[],
      folderId:null,reprompt:0,login:{username:loginUser,password,totp:null,uris:[]}};
    if(update){
      await this.command(user,['sync'],{session:session.key});
      item=this.json(await this.command(user,['get','item',itemId(input.itemId)],{session:session.key}));
      if(item.type!==1||item.organizationId||item.deletedDate)fail(403,'Only personal login items can be updated');
      if(!input.expectedRevision||item.revisionDate!==input.expectedRevision)fail(409,'Vaultwarden item changed. Refresh it before saving.');
      item={...item,name,login:{...item.login,username:loginUser,password},lastKnownRevisionDate:input.expectedRevision};
    }
    // Encoded item JSON (including the password) is passed through stdin, never argv.
    const saved=this.json(await this.command(user,update?['edit','item',input.itemId]:['create','item'],
      {session:session.key,stdin:Buffer.from(JSON.stringify(item)).toString('base64')+'\n'}));
    await this.refreshUnlocked(user);
    return {id:saved.id,name:saved.name,revisionDate:saved.revisionDate};
  });}
  disconnect(user){return this.locked(user,async()=>{
    this.sessions.delete(user);
    try{await this.command(user,['lock']);}catch{}
    return this.status(user);
  });}
  close(){this.sessions.clear();}
}
module.exports={Vaultwarden};
