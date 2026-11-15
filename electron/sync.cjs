'use strict';
const https=require('node:https');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {URL}=require('node:url');
const {secureStorageAvailable}=require('./secure-storage.cjs');
function serverOrigin(value) {
  let url;
  try { url=new URL(String(value||'')); } catch { throw Error('Enter an HTTPS ShiroTerm Server address'); }
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')
    throw Error('Enter an HTTPS server address without credentials, paths or query parameters');
  return url.origin;
}
const {mergeProfiles,equal}=require('./sync-merge.cjs');
class SyncClient {
  constructor(store) {
    this.store=store;
    this.settingsFile=store?.dir?path.join(store.dir,'server-settings.json'):null;
    this.endpoint='';
    try {
      const saved=this.settingsFile?JSON.parse(fs.readFileSync(this.settingsFile,'utf8')):{};
      if(saved.url)this.endpoint=serverOrigin(saved.url);
    } catch { /* A missing or invalid optional server never prevents local startup. */ }
    this.user='';
    this.token='';
    this.passphrase='';
    this.revision=null;
    this.remoteExists=false;
    this.baseline=null;
    this.autoEnabled=false;
    this.autoBusy=false;
    this.autoState='off';
    this.autoError='';
    this.autoConflicts=[];
    this.lastAutoSync=0;
    this.pairing=null;
    this.pairPollInFlight=null;
    this.vaultId='personal';
    this.vaultName='Personal';
    this.sessionExpires=0;
    this.restoreBusy=null;
    this.restoringSession=false;
    this.restoreEpoch=0;
    this.sessionFile=store?.dir?path.join(store.dir,'server-device-session.bin'):null;
  }
  status() {
    return {connected:!!this.token&&!this.restoringSession,user:this.user,url:this.endpoint,
      remembered:!!this.token&&!!this.sessionFile&&
        secureStorageAvailable(this.store?.safeStorage)&&fs.existsSync(this.sessionFile),
      expiresAt:this.sessionExpires,
      reconnectAvailable:!this.token&&!!this.sessionFile&&fs.existsSync(this.sessionFile)&&
        secureStorageAvailable(this.store?.safeStorage),
      encryptionReady:!!this.passphrase,
      pairingCode:this.pairing?.code||'',
      pairingExpiresIn:this.pairing?Math.max(0,Math.ceil((this.pairing.deadline-Date.now())/1000)):0,
      vaultId:this.vaultId,vaultName:this.vaultName,
      revision:this.revision,remoteExists:this.remoteExists,
      autoEnabled:this.autoEnabled,autoReady:!!this.baseline,
      autoState:this.autoState,autoError:this.autoError,
      autoConflicts:this.autoConflicts,lastAutoSync:this.lastAutoSync,
      vaultwarden:'Vaultwarden is connected only through ShiroTerm Server; the desktop has no Bitwarden CLI dependency'};
  }
  logout() {
    this.restoreEpoch++;
    this.restoringSession=false;
    this.clearSessionFile();
    this.token='';this.sessionExpires=0;this.passphrase='';this.user='';this.revision=null;
    this.remoteExists=false;this.baseline=null;this.autoEnabled=false;
    this.autoBusy=false;this.autoState='off';this.autoError='';
    this.autoConflicts=[];this.lastAutoSync=0;
    this.pairing=null;
    this.pairPollInFlight=null;
    this.vaultId='personal';this.vaultName='Personal';
    if(this.store?.activeVaultId && this.store.activeVaultId!=='personal')
      this.store.activateVault('personal');
    return this.status();
  }
  clearSessionFile(){
    if(!this.sessionFile)return;
    try{fs.rmSync(this.sessionFile,{force:true});}catch{}
  }
  configureServer(value){
    const endpoint=serverOrigin(value);
    if(this.settingsFile){
      fs.mkdirSync(path.dirname(this.settingsFile),{recursive:true});
      const temp=this.settingsFile+'.'+process.pid+'.tmp';
      fs.writeFileSync(temp,JSON.stringify({url:endpoint}),{mode:0o600,flag:'wx'});
      try{fs.renameSync(temp,this.settingsFile);}
      finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    }
    this.endpoint=endpoint;
  }
  consoleUrl(){return new URL('/console',serverOrigin(this.endpoint)).href;}
  saveSession(){
    if(!this.sessionFile||!secureStorageAvailable(this.store?.safeStorage)||
       !this.token||!this.user)return false;
    const secured=this.store.safeStorage.encryptString(JSON.stringify({
      version:1,token:this.token,user:this.user,endpoint:this.endpoint,
      expires:this.sessionExpires,
      vaultId:this.vaultId
    }));
    fs.mkdirSync(path.dirname(this.sessionFile),{recursive:true});
    const temp=this.sessionFile+'.'+process.pid+'.tmp';
    fs.writeFileSync(temp,secured,{mode:0o600,flag:'wx'});
    try{fs.renameSync(temp,this.sessionFile);}
    finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    return true;
  }
  async restoreSession(){
    if(this.token||this.pairing||!this.sessionFile||
       !secureStorageAvailable(this.store?.safeStorage))return false;
    if(this.restoreBusy)return this.restoreBusy;
    const epoch=this.restoreEpoch;
    const task=(async()=>{
      let session;
      try{
        const raw=fs.readFileSync(this.sessionFile);
        session=JSON.parse(this.store.safeStorage.decryptString(raw));
      }catch(error){
        if(error?.code==='ENOENT')return false;
        this.clearSessionFile();return false;
      }
      // Upgrade remembered devices from older builds, which did not save the
      // server address separately. This executes only on explicit/auto restore.
      if(!this.endpoint && session?.endpoint){
        try{this.configureServer(session.endpoint);}catch{this.clearSessionFile();return false;}
      }
      if(session?.version!==1||typeof session.token!=='string'||
         !/^[A-Za-z0-9_-]{40,160}$/.test(session.token)||
         !/^[a-z][a-z0-9_.-]{2,47}$/.test(session.user||'')||
         session.endpoint!==this.endpoint||!Number.isSafeInteger(session.expires)||
         session.expires*1000<=Date.now()){
        this.clearSessionFile();return false;
      }
      if(epoch!==this.restoreEpoch||this.token||this.pairing)return false;
      this.token=session.token;this.user=session.user;
      this.sessionExpires=session.expires;
      this.restoringSession=true;
      try{
        let selected='personal',label='Personal';
        if(session.vaultId && session.vaultId!=='personal' &&
           /^[a-f0-9]{32}$/.test(session.vaultId)){
          const list=await this.listProfileVaults();
          const matched=list.find(v=>v.id===session.vaultId);
          if(matched){selected=matched.id;label=matched.name;}
        }
        const path=selected==='personal'?'/v1/snapshot':
          '/v1/profile-vaults/'+selected+'/snapshot';
        const remote=await this.request('GET',path);
        if(epoch!==this.restoreEpoch||this.pairing||!this.token)return false;
        // Switching local collections happens only after the server confirms
        // access to this user and the corresponding encrypted snapshot.
        try{this.store?.activateVault?.(selected);}
        catch(error){
          selected='personal';label='Personal';
          this.store?.activateVault?.('personal');
          this.autoError='Saved vault could not be opened; switched to Personal.';
        }
        this.vaultId=selected;this.vaultName=label;
        if(selected==='personal'&&path!=='/v1/snapshot'){
          const personal=await this.request('GET','/v1/snapshot');
          this.revision=personal.revision;this.remoteExists=!!personal.blob;
        }else{
          this.revision=remote.revision;this.remoteExists=!!remote.blob;
        }
        this.baseline=null;this.autoEnabled=false;this.passphrase='';
        this.restoringSession=false;
        try{
          if(selected!==session.vaultId)this.saveSession();
        }catch{}
        try{this.onRestored?.(this.status());}catch{}
        return true;
      }catch(error){
        this.token='';this.user='';this.sessionExpires=0;
        this.restoringSession=false;
        this.revision=null;this.remoteExists=false;
        if(/Unauthorized|Invalid token|HTTP 401|HTTP 403/i.test(String(error.message||error)))
          this.clearSessionFile();
        return false;
      }
    })();
    this.restoreBusy=task;
    try{return await task;}finally{if(this.restoreBusy===task)this.restoreBusy=null;}
  }
  async signOut(){
    let failed=false;
    try{if(this.token)await this.request('POST','/v1/auth/logout',{});}
    catch{failed=true;}
    this.logout();
    if(failed)throw Error('Local session cleared, but server token revocation could not be confirmed.');
    return this.status();
  }
  request(method,resource,payload) {
    const origin=serverOrigin(this.endpoint);
    const uri=new URL(resource,origin);
    if(uri.origin!==origin||uri.username||uri.password)
      throw Error('Sync requests must stay on the configured server');
    // Custom trust roots are an explicit local deployment option, never bundled.
    const ca=process.env.SHIROTERM_SYNC_CA?fs.readFileSync(process.env.SHIROTERM_SYNC_CA):undefined;
    const body=payload===undefined?null:JSON.stringify(payload);
    if(body && Buffer.byteLength(body)>1900000)throw Error('Sync payload is too large');
    return new Promise((resolve,reject)=>{
      const req=https.request(uri,{
        method,ca,rejectUnauthorized:true,timeout:12000,
        headers:{'Accept':'application/json',
          ...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{}),
          ...(this.token?{'Authorization':'Bearer '+this.token}:{})}
      },res=>{
        const parts=[];let size=0;
        res.on('data',chunk=>{size+=chunk.length;if(size>2100000){req.destroy(Error('Large sync response'));return;}parts.push(chunk);});
        res.on('end',()=>{
          let output;
          try{output=JSON.parse(Buffer.concat(parts).toString('utf8'));}
          catch{return reject(Error('Invalid server response'));}
          if(res.statusCode>=400) return reject(Error(output.error||'Sync HTTP '+res.statusCode));
          resolve(output);
        });
      });
      req.on('timeout',()=>req.destroy(Error('Sync server timed out')));
      req.on('error',reject);
      if(body)req.write(body);
      req.end();
    });
  }
  async pairStart(input){
    if(this.token)throw Error('Sign out before pairing a different account');
    this.configureServer(input?.url||this.endpoint);
    const label=String(input.label||'ShiroTerm desktop').slice(0,70);
    const pending=await this.request('POST','/v1/device/start',{label});
    const portal=new URL(pending.portalUrl||'/console',this.endpoint);
    if(portal.origin!==this.endpoint||portal.username||portal.password)
      throw Error('The authorization page must belong to the configured server');
    this.pairing={id:pending.id,secret:pending.secret,code:pending.code,
      deadline:Date.now()+pending.expiresIn*1000};
    return {code:pending.code,expiresIn:pending.expiresIn,
      portalUrl:portal.href,server:this.endpoint};
  }
  cancelPairing(){
    this.pairing=null;
    // A request already in flight is allowed to finish, but cannot authorize
    // an intentionally cancelled pairing.
    return this.status();
  }
  async pairPoll(){
    if(this.token)return {status:'approved',...this.status()};
    const pairing=this.pairing;
    if(!pairing)return {status:'idle'};
    if(Date.now()>pairing.deadline){
      this.pairing=null;
      return {status:'expired'};
    }
    // React can have multiple consumers, and a status refresh may re-render
    // both. Only ONE request may consume the server's one-time pairing token.
    if(this.pairPollInFlight)return this.pairPollInFlight;
    const task=(async()=>{
      let result;
      try{
        result=await this.request('POST','/v1/device/poll',{
          id:pairing.id,secret:pairing.secret});
      }catch(error){
        if(this.pairing!==pairing)return {status:this.token?'approved':'idle'};
        if(/pairing request expired|pairing request consumed/i.test(String(error?.message||error))){
          this.pairing=null;return {status:'expired'};
        }
        throw error;
      }
      if(this.pairing!==pairing)return {status:this.token?'approved':'idle'};
      if(result.status==='pending')return {status:'pending'};
      if(result.status!=='approved'||typeof result.token!=='string'||!result.user)
        throw Error('Invalid device authorization response');
      this.token=result.token;this.user=result.user;this.pairing=null;
      this.sessionExpires=Number(result.expires)||0;
      try{this.saveSession();}catch{this.autoError='Unable to remember this device securely.';}
      this.baseline=null;this.passphrase='';
      try{
        const remote=await this.request('GET',this.snapshotPath);
        this.revision=remote.revision;this.remoteExists=!!remote.blob;
      }catch{
        // Device authorization succeeded even if fetching optional profile
        // metadata failed. The user can refresh Vaults after reconnecting.
        this.revision=null;this.remoteExists=false;
        this.autoError='Could not load profile metadata; reconnect to refresh.';
      }
      return {status:'approved',...this.status()};
    })();
    this.pairPollInFlight=task;
    try{return await task;}
    finally{if(this.pairPollInFlight===task)this.pairPollInFlight=null;}
  }
  async unlockProfiles(value){
    this.requireLogin();
    const passphrase=String(value||'');
    if(passphrase.length<12||passphrase.length>512)
      throw Error('Enter a separate profile encryption passphrase of at least 12 characters');
    const previous=this.passphrase;
    this.passphrase=passphrase;
    try{
      const remote=await this.request('GET',this.snapshotPath);
      if(remote.blob){
        const data=this.decrypt(remote.blob);
        if(!['Sessions','Folders','Credentials','Macros'].every(k=>Array.isArray(data[k])))
          throw Error('Remote profile data is invalid');
        // This is only a decryption check. A newly paired device must explicitly
        // choose Download or Upload before enabling any automatic synchronization.
        this.baseline=null;
      }else this.baseline=null;
      this.revision=remote.revision;this.remoteExists=!!remote.blob;
      return this.status();
    }catch(err){
      this.passphrase=previous;
      throw Error('Unable to unlock synchronized profiles: incorrect recovery passphrase or damaged backup');
    }
  }
  async login(input) {
    this.logout();
    this.configureServer(input?.url||this.endpoint);
    const username=String(input.username||'').trim().toLowerCase();
    const password=String(input.password||'');
    const passphrase=String(input.passphrase||'');
    if(!username||password.length<12||passphrase.length<12)
      throw Error('Enter the user, account password and a separate encryption passphrase (min. 12 characters)');
    const auth=await this.request('POST','/v1/auth/login',{username,password});
    this.token=auth.token;this.user=auth.user;this.passphrase=passphrase;
    this.sessionExpires=Number(auth.expires)||0;
    try{
      const remote=await this.request('GET',this.snapshotPath);
      this.revision=remote.revision;
      this.remoteExists=!!remote.blob;
    }catch(error){this.logout();throw error;}
    try{this.saveSession();}catch{this.autoError='Unable to remember device login securely.';}
    return this.status();
  }
  get snapshotPath(){return this.vaultId==='personal'?'/v1/snapshot':
    '/v1/profile-vaults/'+this.vaultId+'/snapshot';}
  get historyPath(){return this.vaultId==='personal'?'/v1/history':
    '/v1/profile-vaults/'+this.vaultId+'/history';}
  async listProfileVaults(){
    this.requireLogin();
    const data=await this.request('GET','/v1/profile-vaults');
    return data.vaults;
  }
  async createProfileVault(name){
    this.requireLogin();
    return this.request('POST','/v1/profile-vaults',{name});
  }
  async selectProfileVault(id){
    this.requireLogin();
    if(this.autoBusy)throw Error('Wait for the current sync to finish');
    if(id!=='personal'&&!/^[a-f0-9]{32}$/.test(String(id)))
      throw Error('Invalid vault identifier');
    const vaults=await this.listProfileVaults();
    const next=vaults.find(v=>v.id===id);
    if(!next)throw Error('Vault not found or access denied');
    if(this.vaultId===id)return this.status();
    const path=id==='personal'?'/v1/snapshot':'/v1/profile-vaults/'+id+'/snapshot';
    const remote=await this.request('GET',path);
    this.store.activateVault(id);
    this.vaultId=id;this.vaultName=next.name;
    this.revision=remote.revision;this.remoteExists=!!remote.blob;
    this.passphrase='';this.baseline=null;this.autoEnabled=false;
    this.autoBusy=false;this.autoState='off';this.autoError='';
    this.autoConflicts=[];this.lastAutoSync=0;
    try{this.saveSession();}catch{this.autoError='Could not remember the selected vault.';}
    return this.status();
  }
  requireLogin() {if(!this.token)throw Error('Log in to Sync first');}
  requireEncryption(){this.requireLogin();if(!this.passphrase)
    throw Error('Unlock encrypted profiles with your separate recovery passphrase first');}
  async history(){
    this.requireLogin();
    const list=await this.request('GET',this.historyPath);
    return list.versions||[];
  }
  async restoreVersion(revision){
    this.requireEncryption();
    if(this.autoBusy)throw Error('Wait until automatic sync finishes.');
    if(!Number.isSafeInteger(revision)||revision<1)throw Error('Invalid snapshot revision');
    this.autoEnabled=false;this.autoState='off';
    const previous=await this.request('GET',this.historyPath+'/'+revision);
    const remote=await this.request('GET',this.snapshotPath);
    if(!remote.blob)throw Error('Current server snapshot is missing');
    let data;
    try{data=this.decrypt(previous.blob);}
    catch{throw Error('Cannot decrypt this historical version');}
    if(!['Sessions','Folders','Credentials','Macros']
      .every(key=>Array.isArray(data[key])))
      throw Error('Historical snapshot has an invalid structure');
    const saved=await this.request('PUT',this.snapshotPath,{
      expected_revision:remote.revision,blob:previous.blob});
    this.store.replaceSynced(data); // Atomic local backup is made by Store.
    this.baseline=data;this.revision=saved.revision;this.remoteExists=true;
    this.autoConflicts=[];this.autoError='';
    return {...this.status(),themePreferences:data.ThemePreferences||null};
  }
  async vaultStatus(){
    if(!this.token)return {configured:false,connected:false,server:this.endpoint,
      account:'',lastSync:0,lastAttempt:0,lastError:'',expiresInSeconds:0,
      itemCount:0,syncIntervalSeconds:300};
    return this.request('GET','/v1/vault/status');
  }
  async vaultSync(){this.requireLogin();return this.request('POST','/v1/vault/sync',{});}
  async vaultItems(){this.requireLogin();return this.request('GET','/v1/vault/items');}
  async vaultDisconnect(){this.requireLogin();return this.request('POST','/v1/vault/disconnect',{});}
  async vaultPassword(itemId){this.requireLogin();const response=await this.request('POST','/v1/vault/password',{itemId});return response.password;}
  async vaultCreateItem(input){this.requireLogin();return this.request('POST','/v1/vault/item/create',input);}
  async vaultUpdateItem(input){this.requireLogin();return this.request('POST','/v1/vault/item/update',input);}
  encrypt(data) {
    if(!this.passphrase)throw Error('Profile encryption is locked');
    const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12);
    const key=crypto.scryptSync(this.passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
    const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
    const body=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
    key.fill(0);
    return {salt:salt.toString('base64'),iv:iv.toString('base64'),
      tag:cipher.getAuthTag().toString('base64'),data:body.toString('base64')};
  }
  decrypt(blob) {
    if(!this.passphrase)throw Error('Profile encryption is locked');
    const salt=Buffer.from(blob.salt,'base64'),iv=Buffer.from(blob.iv,'base64');
    const key=crypto.scryptSync(this.passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
    try{
      const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
      decipher.setAuthTag(Buffer.from(blob.tag,'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(blob.data,'base64')),decipher.final()]).toString('utf8'));
    }finally{key.fill(0);}
  }
  snapshot(themePreferences=null){
    const local=this.store.list();
    return {Sessions:local.Sessions.map(({KeyFile,HasStoredPassword,...h})=>h),
      Folders:local.Folders,Credentials:local.Credentials.map(({HasStoredPassword,...c})=>c),
      Macros:local.Macros,ThemePreferences:themePreferences,imported:true};
  }
  async upload(allowReplace=false,themePreferences=null) {
    this.requireEncryption();
    if(this.autoBusy)throw Error('Wait until automatic sync finishes.');
    this.autoEnabled=false;this.autoState='off';
    const remote=await this.request('GET',this.snapshotPath);
    if(remote.revision!==this.revision)throw Error('Conflict: remote configuration changed. Download and review it first.');
    if(remote.blob&&!allowReplace)throw Error('Remote data exists. Confirm replacement before uploading.');
    const payload=this.snapshot(themePreferences);
    const response=await this.request('PUT',this.snapshotPath,{
      expected_revision:this.revision,blob:this.encrypt(payload)});
    this.revision=response.revision;this.remoteExists=true;
    this.baseline=payload;this.autoConflicts=[];this.autoError='';
    this.autoState=this.autoEnabled?'idle':'off';
    return this.status();
  }
  async download() {
    this.requireEncryption();
    if(this.autoBusy)throw Error('Wait until automatic sync finishes.');
    this.autoEnabled=false;this.autoState='off';
    const remote=await this.request('GET',this.snapshotPath);
    if(!remote.blob)throw Error('No remote backup for this account');
    let data;
    try{data=this.decrypt(remote.blob);}
    catch{throw Error('Decryption failed: incorrect encryption passphrase or damaged snapshot');}
    if(!Array.isArray(data.Sessions)||!Array.isArray(data.Folders)||
      !Array.isArray(data.Credentials)||!Array.isArray(data.Macros))
      throw Error('Invalid synced profile data');
    this.store.replaceSynced(data);
    this.revision=remote.revision;this.remoteExists=true;
    this.baseline=data;this.autoConflicts=[];this.autoError='';
    this.autoState=this.autoEnabled?'idle':'off';
    return {...this.status(),themePreferences:data.ThemePreferences||null};
  }
  setAuto(enabled){
    this.requireEncryption();
    if(enabled && !this.baseline)
      throw Error('First download or upload your profiles to establish a safe sync baseline.');
    if(this.autoBusy)throw Error('Synchronization is currently running.');
    this.autoEnabled=enabled===true;
    this.autoState=this.autoEnabled?'idle':'off';
    if(!this.autoEnabled){this.autoError='';this.autoConflicts=[];}
    return this.status();
  }
  async autoTick(themePreferences=null){
    if(!this.autoEnabled||!this.token)return {...this.status(),changedLocal:false};
    if(this.autoBusy)return {...this.status(),changedLocal:false};
    if(!this.baseline){
      this.autoEnabled=false;this.autoState='off';
      return {...this.status(),changedLocal:false};
    }
    this.autoBusy=true;this.autoState='checking';
    try{
      const local=this.snapshot(themePreferences),before=this.baseline;
      const remote=await this.request('GET',this.snapshotPath);
      if(!remote.blob)throw Error('Server snapshot disappeared; automatic synchronization stopped.');
      let theirs;
      try{theirs=this.decrypt(remote.blob);}
      catch{throw Error('Cannot decrypt remote snapshot. Check the encryption passphrase.');}
      const {merged,conflicts}=mergeProfiles(before,local,theirs);
      if(conflicts.length){
        this.autoConflicts=conflicts;this.autoState='conflict';
        this.autoError='Concurrent edits need manual resolution; no data was overwritten.';
        this.lastConflictRevision=remote.revision;
        return {...this.status(),changedLocal:false};
      }
      // The user may have edited a host while the server request was in flight.
      if(!equal(local,this.snapshot(themePreferences)))
        throw Error('Local profiles changed during sync. Retrying on next check.');
      const remoteNeedsWrite=!equal(merged,theirs);
      const localNeedsApply=!equal(merged,local);
      let revision=remote.revision;
      if(remoteNeedsWrite){
        const saved=await this.request('PUT',this.snapshotPath,{
          expected_revision:remote.revision,blob:this.encrypt(merged)});
        revision=saved.revision;
      }
      let changedLocal=false;
      if(localNeedsApply && equal(local,this.snapshot(themePreferences))){
        this.store.replaceSynced(merged);
        changedLocal=true;
      }else if(localNeedsApply){
        throw Error('Local profiles changed during sync; remote was saved, retrying reconciliation.');
      }
      this.baseline=merged;this.revision=revision;this.remoteExists=true;
      this.autoConflicts=[];this.autoError='';this.autoState='idle';
      this.lastAutoSync=Date.now();
      return {...this.status(),changedLocal,
        themePreferences:changedLocal?(merged.ThemePreferences||null):null};
    }catch(error){
      this.autoError=error instanceof Error?error.message:String(error);
      this.autoState='error';
      return {...this.status(),changedLocal:false};
    }finally{this.autoBusy=false;}
  }
  async resolveKeepLocal(themePreferences=null){
    this.requireEncryption();
    if(this.autoState!=='conflict'||!this.autoConflicts.length)
      throw Error('There is no pending synchronization conflict to resolve.');
    if(this.autoBusy)throw Error('Synchronization already running');
    const remote=await this.request('GET',this.snapshotPath);
    if(remote.revision!==this.lastConflictRevision)
      throw Error('Server changed again. Check synchronization conflicts before overwriting.');
    if(!remote.blob)throw Error('Server snapshot missing');
    this.decrypt(remote.blob); // Ensure the currently unlocked passphrase can read the latest data.
    const payload=this.snapshot(themePreferences);
    const saved=await this.request('PUT',this.snapshotPath,{
      expected_revision:remote.revision,blob:this.encrypt(payload)});
    this.baseline=payload;this.revision=saved.revision;this.remoteExists=true;
    this.autoConflicts=[];this.autoError='';this.autoState='idle';
    this.lastAutoSync=Date.now();
    return this.status();
  }
}
module.exports={SyncClient};
