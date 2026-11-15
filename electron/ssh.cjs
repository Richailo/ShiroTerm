'use strict';
const {Client}=require('ssh2');
const {loadPrivateKey}=require('./ssh-auth.cjs');
const {probe}=require('./host-detection.cjs');
const {action:sftpAction,folderPath}=require('./sftp-actions.cjs');
const path=require('node:path');
const crypto=require('node:crypto');
const {dialog}=require('electron');
const RETRY_DELAYS=[2000,4000,8000,16000,30000];
const STABLE_UPTIME_MS=30000;

class Connections {
  constructor(win,store,activity=null){
    this.win=win;this.store=store;this.activity=activity;
    this.sessions=new Map();this.pending=new Map();
    // Reconnection entries contain only host IDs and terminal dimensions, never secrets.
    this.reconnect=new Map();
    this.reconnectDelays=[...RETRY_DELAYS];
    this.stableUptimeMs=STABLE_UPTIME_MS;
  }
  emit(type,data){
    if(this.activity){
      const host=this.sessions.get(data.sessionId)?.profile;
      this.activity.record({type,...data},host?host.Name||host.Host:'');
    }
    if(!this.win.isDestroyed())this.win.webContents.send('ssh:event',{type,...data});
  }
  verifyHost(profile,sessionId,hash,callback){
    const known=this.store.lookupFingerprint(profile.Host,profile.Port);
    if(known&&known.hash===hash){callback(true);return;}
    const requestId=crypto.randomUUID();
    const timer=setTimeout(()=>{
      const request=this.pending.get(requestId);
      if(request){
        this.pending.delete(requestId);
        request.callback(false);
      }
    },60000);
    this.pending.set(requestId,{
      sessionId,host:profile.Host,port:profile.Port,hash,callback,timer
    });
    this.emit('verify',{sessionId,requestId,
      host:profile.Host,port:profile.Port,fingerprint:hash,
      changed:!!known,oldFingerprint:known?.hash||''});
  }
  acceptHost(requestId,approved){
    const pending=this.pending.get(requestId);
    if(!pending)return false;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    if(approved){
      try{this.store.trustFingerprint(pending.host,pending.port,pending.hash);}
      catch(err){pending.callback(false);throw err;}
    }
    pending.callback(!!approved);
    return true;
  }
  credentialsFor(profile,sessionId,password='',keyPassphrase=''){
    const shared=profile.CredentialId?
      this.store.config.Credentials.find(c=>c.Id===profile.CredentialId):null;
    const username=(profile.User||'').trim()||(shared?.User||'').trim();
    if(!username)throw new Error('Enter an SSH username for '+profile.Name);
    const credentials=this.store.passwordForHost(profile,password);
    const options={
      host:profile.Host,port:profile.Port,username,
      readyTimeout:15000,
      keepaliveInterval:Math.max(5,Number(profile.SshKeepAliveSeconds)||30)*1000,
      keepaliveCountMax:3,hostHash:'sha256',
      hostVerifier:(hash,callback)=>this.verifyHost(profile,sessionId,hash,callback)
    };
    if(credentials){
      options.password=credentials;
      options.tryKeyboard=true;
    }
    const key=profile.KeyFile||'';
    if(!credentials&&!key)throw new Error(
      'No SSH authentication configured. Enter a password or choose a private key.');
    if(key)Object.assign(options,loadPrivateKey(key,keyPassphrase));
    return options;
  }
  findJump(profile){
    if(!profile.JumpHost)return null;
    const gateway=this.store.config.Sessions.find(h=>h.Id===profile.JumpHost);
    if(!gateway)
      throw new Error('Jump host must be selected from saved SSH hosts');
    if(gateway.Id===profile.Id)throw new Error('Host cannot jump through itself');
    if(!['SSH','SFTP'].includes(gateway.Protocol))
      throw new Error('Jump host must use SSH');
    if(gateway.JumpHost)
      throw new Error('Chained jump hosts are not yet supported');
    return gateway;
  }
  stopReconnect(sessionId){
    const retry=this.reconnect.get(sessionId);
    if(!retry)return false;
    if(retry.timer)clearTimeout(retry.timer);
    this.reconnect.delete(sessionId);
    return true;
  }
  cancelReconnect(sessionId){
    const stopped=this.stopReconnect(sessionId);
    if(stopped){
      this.endSession(sessionId,true);
      this.emit('status',{sessionId,status:'reconnect-stopped'});
    }
    return stopped;
  }
  scheduleReconnect(sessionId,record){
    const retry=this.reconnect.get(sessionId);
    if(!retry)return;
    const host=this.store.config.Sessions.find(h=>h.Id===retry.hostId);
    if(!retry.everConnected||record.manual||record.retryBlocked||
      !host?.AutoReconnect){
      this.stopReconnect(sessionId);
      return;
    }
    if(record.readyAt&&Date.now()-record.readyAt>=this.stableUptimeMs)
      retry.attempt=0;
    if(retry.attempt>=this.reconnectDelays.length){
      this.stopReconnect(sessionId);
      this.emit('status',{sessionId,status:'reconnect-exhausted'});
      return;
    }
    const delayMs=this.reconnectDelays[retry.attempt];
    const attempt=++retry.attempt;
    this.emit('status',{sessionId,status:'reconnect-wait',attempt,
      maxAttempts:this.reconnectDelays.length,delayMs});
    retry.timer=setTimeout(async()=>{
      if(this.reconnect.get(sessionId)!==retry)return;
      retry.timer=null;
      this.emit('status',{sessionId,status:'reconnect-attempt',attempt,
        maxAttempts:this.reconnectDelays.length});
      try{
        await this.connect({id:retry.hostId,sessionId,
          cols:retry.cols,rows:retry.rows});
      }catch(error){
        if(this.reconnect.get(sessionId)!==retry)return;
        this.stopReconnect(sessionId);
        this.emit('error',{sessionId,message:error.message});
        this.emit('status',{sessionId,status:'reconnect-exhausted'});
      }
    },delayMs);
  }
  async connect({id,password='',keyPassphrase='',jumpPassphrase='',cols=100,rows=28,sessionId:requestedId}={}){
    const profile=this.store.config.Sessions.find(h=>h.Id===id);
    if(!profile)throw new Error('Host was not found');
    if(!['SSH','SFTP'].includes(profile.Protocol))
      throw new Error('This protocol is not migrated yet');
    const sessionId=typeof requestedId==='string'&&
      /^[0-9a-f-]{36}$/i.test(requestedId)?requestedId:crypto.randomUUID();
    if(this.sessions.has(sessionId))throw new Error('Duplicate SSH session ID');
    const gatewayProfile=this.findJump(profile);
    // Resolve options and private keys before inserting a live record.
    const options=this.credentialsFor(profile,sessionId,password,keyPassphrase);
    const gatewayOptions=gatewayProfile?
      this.credentialsFor(gatewayProfile,sessionId,'',jumpPassphrase):null;
    const previousRetry=this.reconnect.get(sessionId);
    if(!previousRetry && profile.AutoReconnect &&
      !password && !keyPassphrase && !jumpPassphrase){
      this.reconnect.set(sessionId,{
        hostId:id,attempt:0,timer:null,everConnected:false,
        cols:Math.max(20,Math.min(500,cols|0)),
        rows:Math.max(5,Math.min(200,rows|0))
      });
    }
    const client=new Client();
    // Support servers using keyboard-interactive for an ordinary SSH password,
    // without automatically submitting a password to OTP or MFA prompts.
    const interactive=(secret,finishPrompts)=>(name,instructions,lang,prompts,finish)=>{
      const onePassword=prompts.length===1&&
        /password/i.test(prompts[0]?.prompt||'');
      finish(onePassword&&secret?[secret]:[]);
    };
    if(options.password)
      client.on('keyboard-interactive',
        interactive(options.password));
    let signalReady,signalError;
    const readyPromise=new Promise((resolve,reject)=>{
      signalReady=resolve;signalError=reject;
    });
    readyPromise.catch(()=>{});
    const record={
      client,gateway:null,jumpChannel:null,stream:null,sftp:null,sftpPromise:null,
      profile,closing:false,ready:false,manual:false,retryBlocked:false,
      readyPromise,signalReady,signalError,
      cols:Math.max(20,Math.min(500,cols|0)),
      rows:Math.max(5,Math.min(200,rows|0))
    };
    this.sessions.set(sessionId,record);
    let finished=false;
    const fail=err=>{
      if(finished||record.closing)return;
      if(!record.ready)record.signalError(err);
      const code=err?.code||'';
      const message=err?.message||'SSH connection error';
      // Authentication and host key failures must never be retried automatically.
      if(!record.ready &&
        !['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EHOSTUNREACH',
          'ENETUNREACH','EPIPE'].includes(code) &&
        !/timed out|socket hang up|connection reset|connection refused/i.test(message))
        record.retryBlocked=true;
      this.emit('error',{sessionId,message});
      this.endSession(sessionId);
    };
    const openTarget=sock=>{
      if(record.closing){sock?.destroy();return;}
      record.targetStarted=true;
      try{client.connect(sock?{...options,sock}:options);}
      catch(err){fail(err);}
    };
    client.on('ready',()=>{
      record.ready=true;
      record.readyAt=Date.now();
      const retry=this.reconnect.get(sessionId);
      if(retry)retry.everConnected=true;
      record.signalReady();
      this.emit('status',{sessionId,status:'connected'});
      // Independent read-only probe; never send detection commands to the
      // interactive terminal or display their output to the user.
      record.stopProbe=probe(client,result=>{
        if(!result||record.closing||this.sessions.get(sessionId)!==record)return;
        try{this.store.saveHostDetection?.(profile.Id,result);}
        catch{return;}
        this.emit('platform',{sessionId,hostId:profile.Id,...result});
      });
      if(profile.Protocol==='SFTP'){
        this.emit('status',{sessionId,status:'sftp-ready'});
        return;
      }
      client.shell({term:'xterm-256color',cols:record.cols,rows:record.rows},
        (err,stream)=>{
          if(err){fail(err);return;}
          if(record.closing){stream.end();return;}
          record.stream=stream;
          stream.on('data',chunk=>this.emit('data',{
            sessionId,data:chunk.toString('utf8')
          }));
          stream.stderr?.on('data',chunk=>this.emit('data',{
            sessionId,data:chunk.toString('utf8')
          }));
          // An explicit shell exit (e.g. "exit") is not a network interruption.
          stream.on('exit',()=>{record.retryBlocked=true;});
          stream.on('close',()=>this.endSession(sessionId));
          this.emit('status',{sessionId,status:'shell-ready'});
        });
    });
    client.on('error',fail);
    const finish=()=>{
      if(finished)return;
      finished=true;
      if(!record.ready)record.signalError(new Error('SSH connection closed'));
      record.closing=true;
      this.sessions.delete(sessionId);
      for(const [requestId,pending] of this.pending){
        if(pending.sessionId!==sessionId)continue;
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        pending.callback(false);
      }
      record.stopProbe?.();
      record.jumpChannel?.destroy();
      record.gateway?.end();
      this.emit('status',{sessionId,status:'closed'});
      this.scheduleReconnect(sessionId,record);
    };
    record.finish=finish;
    client.on('close',finish);
    if(!gatewayProfile){
      this.emit('status',{sessionId,status:'connecting'});
      openTarget(null);
      return {sessionId};
    }
    const gateway=new Client();
    if(gatewayOptions?.password)
      gateway.on('keyboard-interactive',
        interactive(gatewayOptions.password));
    record.gateway=gateway;
    this.emit('status',{sessionId,status:'connecting-jump'});
    gateway.on('ready',()=>{
      if(record.closing){gateway.end();return;}
      this.emit('status',{sessionId,status:'jump-connected'});
      gateway.forwardOut('127.0.0.1',0,profile.Host,profile.Port,(err,channel)=>{
        if(err){fail(err);return;}
        if(record.closing){channel.destroy();return;}
        record.jumpChannel=channel;
        channel.on('error',fail);
        channel.on('close',()=>{
          if(!record.closing)this.endSession(sessionId);
        });
        openTarget(channel);
      });
    });
    gateway.on('error',fail);
    gateway.on('close',()=>{
      if(!record.closing)this.endSession(sessionId);
    });
    try{gateway.connect(gatewayOptions);}
    catch(err){fail(err);}
    return {sessionId};
  }
  write(sessionId,data){
    const session=this.sessions.get(sessionId);
    if(!session?.stream)throw new Error('Terminal session is not ready');
    if(typeof data!=='string'||data.length>128*1024)
      throw new Error('Invalid terminal input');
    session.stream.write(data);
  }
  resize(sessionId,cols,rows){
    const record=this.sessions.get(sessionId);
    if(!record||!Number.isFinite(cols)||!Number.isFinite(rows))return;
    record.rows=Math.max(5,Math.min(200,rows|0));
    record.cols=Math.max(20,Math.min(500,cols|0));
    const retry=this.reconnect.get(sessionId);
    if(retry){retry.cols=record.cols;retry.rows=record.rows;}
    if(record.stream)record.stream.setWindow(record.rows,record.cols,0,0);
  }
  disconnect(sessionId){
    this.stopReconnect(sessionId);
    this.endSession(sessionId,true);
  }
  endSession(sessionId,manual=false){
    const record=this.sessions.get(sessionId);
    if(!record||record.closing)return;
    record.manual=manual;
    record.closing=true;
    if(record.ready)record.client.end();
    else record.client.destroy();
    record.jumpChannel?.destroy();
    record.gateway?.end();
    if(!record.ready)record.finish();
  }
  async getSftp(sessionId){
    const record=this.sessions.get(sessionId);
    if(!record)throw new Error('SSH session is closed');
    if(!record.ready)await record.readyPromise;
    if(!this.sessions.has(sessionId))throw new Error('SSH session is closed');
    if(record.sftp)return record.sftp;
    if(!record.sftpPromise)record.sftpPromise=new Promise((resolve,reject)=>{
      record.client.sftp((error,sftp)=>{
        if(error){reject(new Error('SFTP subsystem unavailable: '+error.message));return;}
        if(record.closing||this.sessions.get(sessionId)!==record){
          sftp.end();
          reject(new Error('SSH session closed before SFTP was ready'));
          return;
        }
        record.sftp=sftp;
        const invalidate=()=>{
          if(record.sftp!==sftp)return;
          record.sftp=null;
          record.sftpPromise=null;
          if(!record.closing&&this.sessions.get(sessionId)===record)
            this.emit('status',{sessionId,status:'sftp-closed'});
        };
        sftp.once('end',invalidate);
        sftp.once('close',invalidate);
        sftp.on('error',error=>{
          invalidate();
          if(!record.closing&&this.sessions.get(sessionId)===record)
            this.emit('error',{sessionId,message:'SFTP channel error: '+error.message});
        });
        resolve(sftp);
      });
    }).catch(err=>{record.sftpPromise=null;throw err;});
    return record.sftpPromise;
  }
  async list(sessionId,remotePath){
    remotePath=folderPath(remotePath);
    const sftp=await this.getSftp(sessionId);
    return new Promise((resolve,reject)=>sftp.readdir(remotePath,(err,entries)=>{
      if(err){reject(err);return;}
      resolve(entries.map(e=>({
        name:e.filename,
        directory:typeof e.attrs.isDirectory==='function'?
          e.attrs.isDirectory():!!(e.attrs.mode&0o040000),
        size:e.attrs.size||0,mtime:e.attrs.mtime||0
      })).sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name)));
    }));
  }
  async manageSftp(sessionId,request){
    const sftp=await this.getSftp(sessionId);
    return sftpAction(sftp,request);
  }
  async transfer(sessionId,direction,remotePath){
    if(typeof remotePath!=='string'||!remotePath.startsWith('/')||
      remotePath.length>4096)throw new Error('Expected an absolute remote path');
    const sftp=await this.getSftp(sessionId);
    let local;
    if(direction==='download'){
      const result=await dialog.showSaveDialog(this.win,{
        defaultPath:path.basename(remotePath)
      });
      if(result.canceled)return {canceled:true};
      local=result.filePath;
    }else if(direction==='upload'){
      const result=await dialog.showOpenDialog(this.win,{
        properties:['openFile']
      });
      if(result.canceled)return {canceled:true};
      local=result.filePaths[0];
    }else throw new Error('Invalid transfer type');
    await new Promise((resolve,reject)=>{
      const complete=err=>err?reject(err):resolve();
      if(direction==='download')sftp.fastGet(remotePath,local,complete);
      else sftp.fastPut(local,remotePath.replace(/\/$/,'')+'/'+path.basename(local),complete);
    });
    return {canceled:false};
  }
  closeAll(){
    for(const id of [...this.reconnect.keys()])this.stopReconnect(id);
    for(const id of [...this.sessions.keys()])this.disconnect(id);
  }
}
module.exports={Connections};
