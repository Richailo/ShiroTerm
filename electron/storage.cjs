'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {secureStorageAvailable}=require('./secure-storage.cjs');

const isValidPort = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535;
const text = (value, max = 2048) => String(value ?? '').slice(0, max);
function normalizeHost(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid host record');
  const Host = text(raw.Host ?? raw.host, 253).trim();
  if (!Host || !/^[\x21-\x7e]+$/.test(Host)) throw new Error('Host address is required');
  const protocol = text(raw.Protocol ?? raw.protocol ?? 'SSH', 16).toUpperCase();
  return {
    Id: text(raw.Id ?? raw.id ?? crypto.randomUUID(), 100) || crypto.randomUUID(),
    Name: text(raw.Name ?? raw.name ?? Host, 128).trim() || Host,
    Host, Protocol: ['SSH','SFTP','RDP','TELNET'].includes(protocol) ? protocol : 'SSH',
    Port: isValidPort(raw.Port ?? raw.port) ? Number(raw.Port ?? raw.port) :
      protocol==='RDP'?3389:protocol==='TELNET'?23:22,
    User: text(raw.User ?? raw.user ?? '', 128),
    CredentialId: text(raw.CredentialId ?? raw.credentialId ?? '', 100),
    FolderId: text(raw.FolderId ?? raw.folderId ?? '', 100),
    Tags: text(raw.Tags ?? raw.tags ?? '', 320),
    Notes: text(raw.Notes ?? raw.notes ?? '', 4096),
    Favorite: !!(raw.Favorite ?? raw.favorite),
    KeyFile: text(raw.KeyFile ?? raw.keyFile ?? '', 1024),
    JumpHost: text(raw.JumpHost ?? raw.jumpHost ?? '', 253),
    AutoReconnect: !!(raw.AutoReconnect ?? raw.autoReconnect),
    DetectedPlatform:text(raw.DetectedPlatform||'',24),
    DetectedRole:text(raw.DetectedRole||'',24),
    DetectedVersion:text(raw.DetectedVersion||'',95),
    DetectedAt:text(raw.DetectedAt||'',40),
    PlatformOverride:text(raw.PlatformOverride||'',24),
    SshKeepAliveSeconds: Math.max(5,Math.min(300,Number(raw.SshKeepAliveSeconds)||30))
  };
}
function normalizeFolders(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0,2000).map(f => ({
    Id: text(f.Id || f.id || crypto.randomUUID(), 100),
    Name: text(f.Name || f.name || 'Folder', 128),
    ParentId: text(f.ParentId || f.parentId || '', 100)
  }));
}
function normalizeCredential(raw) {
  if(!raw || typeof raw !== 'object')throw new Error('Invalid credential');
  return {
    Id:text(raw.Id ?? raw.id ?? crypto.randomUUID(),100)||crypto.randomUUID(),
    Name:text(raw.Name ?? raw.name ?? 'Credential',128).trim()||'Credential',
    User:text(raw.User ?? raw.user ?? '',128),
    Notes:text(raw.Notes ?? raw.notes ?? '',2048),
    VaultItemId:text(raw.VaultItemId ?? '',64)
  };
}
function importLegacyJson(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid legacy configuration');
  return {
    Sessions: (Array.isArray(data.Sessions) ? data.Sessions : [])
      .slice(0,10000).flatMap(h => { try{return [normalizeHost(h)];}catch{return [];} }),
    Folders: normalizeFolders(data.Folders),
    Credentials:(Array.isArray(data.Credentials)?data.Credentials:[])
      .slice(0,2000).flatMap(c=>{try{return [normalizeCredential(c)];}catch{return [];} }),
    Macros:(Array.isArray(data.Macros)?data.Macros:[]).slice(0,5000).map(m=>({
      Id:text(m.Id||crypto.randomUUID(),100),
      Name:text(m.Name||'Snippet',128),
      Command:text(m.Command||'',16384)
    })),
    imported: true
  };
}
function safeRead(file) {
  try { return JSON.parse(fs.readFileSync(file,'utf8')); }
  catch(e) { if(e.code==='ENOENT') return null; throw e; }
}
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+'.'+process.pid+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(data,null,2),{mode:0o600,flag:'wx'});
  try {
    if(fs.existsSync(file)) fs.copyFileSync(file,file+'.backup');
    fs.renameSync(temp,file);
  } finally { if(fs.existsSync(temp))fs.unlinkSync(temp); }
}
class Store {
  constructor(dir,safeStorage) {
    this.dir=dir; this.safeStorage=safeStorage;
    this.configFile=path.join(dir,'profiles-v2.json');
    this.activeVaultId='personal';
    this.secretFile=path.join(dir,'secrets-v2.json');
    this.knownFile=path.join(dir,'known-hosts-v2.json');
    const legacy=process.env.LOCALAPPDATA?
      path.join(process.env.LOCALAPPDATA,'ShiroTerm','ProfileData','config.json'):null;
    let config=safeRead(this.configFile);
    if(!config) {
      const raw=legacy && fs.existsSync(legacy) ? safeRead(legacy) : null;
      config=raw ? importLegacyJson(raw) : {Sessions:[],Folders:[],imported:false};
      atomicWrite(this.configFile,config);
    }
    this.config=config;
    if(!Array.isArray(this.config.Macros))this.config.Macros=[];
    if(!Array.isArray(this.config.Credentials)) {
      const source=legacy && fs.existsSync(legacy)?safeRead(legacy):null;
      this.config.Credentials=source?importLegacyJson(source).Credentials:[];
      atomicWrite(this.configFile,this.config);
    }
    this.secrets=safeRead(this.secretFile)||{};
    this.known=safeRead(this.knownFile)||{};
  }
  activateVault(id) {
    if(id!=='personal' && (typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id)))
      throw Error('Invalid profile vault identifier');
    if(id===this.activeVaultId)return this.list();
    const destination=id==='personal'?path.join(this.dir,'profiles-v2.json'):
      path.join(this.dir,'profiles-vault-'+id+'.json');
    const next=safeRead(destination)||{Sessions:[],Folders:[],Credentials:[],Macros:[],imported:true};
    if(!Array.isArray(next.Sessions)||!Array.isArray(next.Folders)||
       !Array.isArray(next.Credentials)||!Array.isArray(next.Macros))
      throw Error('Vault profile file has invalid structure');
    // Every vault has a separate local file. Existing personal profiles stay untouched.
    if(!fs.existsSync(destination))atomicWrite(destination,next);
    this.configFile=destination;
    this.config=next;
    this.activeVaultId=id;
    return this.list();
  }
  list() {
    const result=JSON.parse(JSON.stringify(this.config));
    result.Credentials=result.Credentials.map(c=>({...c,
      HasStoredPassword:!!this.secrets['credential:'+c.Id]}));
    result.Sessions=result.Sessions.map(h=>({...h,
      HasStoredPassword:!!this.secrets[h.Id]}));
    return result;
  }
  replaceSynced(data) {
    const synced=importLegacyJson(data);
    const keyPaths=new Map(this.config.Sessions.map(h=>[h.Id,h.KeyFile||'']));
    synced.Sessions=synced.Sessions.map(h=>({...h,KeyFile:keyPaths.get(h.Id)||''}));
    this.config=synced;
    atomicWrite(this.configFile,this.config);
    return this.list();
  }
  saveCredential(raw) {
    const item=normalizeCredential(raw);
    const index=this.config.Credentials.findIndex(c=>c.Id===item.Id);
    if(index>=0)this.config.Credentials[index]=item;
    else this.config.Credentials.push(item);
    atomicWrite(this.configFile,this.config);
    return {...item,HasStoredPassword:!!this.secrets['credential:'+item.Id]};
  }
  removeCredential(id) {
    if(typeof id!=='string'||!id||id.length>100)throw new Error('Invalid credential ID');
    this.config.Credentials=this.config.Credentials.filter(c=>c.Id!==id);
    for(const host of this.config.Sessions) {
      if(host.CredentialId===id)host.CredentialId='';
    }
    atomicWrite(this.configFile,this.config);
    delete this.secrets['credential:'+id];
    atomicWrite(this.secretFile,this.secrets);
  }
  saveCredentialPassword(id,password) {
    if(!this.config.Credentials.some(c=>c.Id===id))throw new Error('Credential missing');
    this.savePassword('credential:'+id,password);
  }
  passwordForHost(host,provided='') {
    if(provided)return provided;
    const hostPass=this.readPassword(host.Id);
    if(hostPass)return hostPass;
    if(host.CredentialId && this.config.Credentials.some(c=>c.Id===host.CredentialId))
      return this.readPassword('credential:'+host.CredentialId);
    return '';
  }
  saveHost(raw) {
    const item=normalizeHost(raw);
    const i=this.config.Sessions.findIndex(x=>x.Id===item.Id);
    if(i>=0)this.config.Sessions[i]=item;
    else this.config.Sessions.push(item);
    atomicWrite(this.configFile,this.config);
    return item;
  }
  saveHostDetection(id,result){
    const host=this.config.Sessions.find(h=>h.Id===id);
    if(!host)return null;
    host.DetectedPlatform=text(result.platform,24);
    host.DetectedRole=text(result.role,24);
    host.DetectedVersion=text(result.version,95);
    host.DetectedAt=new Date().toISOString();
    atomicWrite(this.configFile,this.config);
    return host;
  }
  removeHost(id) {
    this.config.Sessions=this.config.Sessions.filter(h=>h.Id!==id);
    atomicWrite(this.configFile,this.config);
    delete this.secrets[id]; atomicWrite(this.secretFile,this.secrets);
  }
  saveSnippet(raw) {
    if(!raw||typeof raw!=='object')throw new Error('Invalid snippet');
    const item={
      Id:text(raw.Id||crypto.randomUUID(),100),
      Name:text(raw.Name||'Untitled snippet',128),
      Command:text(raw.Command||'',16384)
    };
    if(!item.Command.trim())throw new Error('Snippet command cannot be empty');
    const i=this.config.Macros.findIndex(x=>x.Id===item.Id);
    if(i>=0)this.config.Macros[i]=item;
    else this.config.Macros.push(item);
    atomicWrite(this.configFile,this.config);
    return item;
  }
  removeSnippet(id) {
    this.config.Macros=this.config.Macros.filter(x=>x.Id!==id);
    atomicWrite(this.configFile,this.config);
  }
  knownHosts() {
    return Object.entries(this.known).map(([id,record])=>({id,...record}));
  }
  removeKnownHost(id) {
    delete this.known[id];
    atomicWrite(this.knownFile,this.known);
  }
  savePassword(id,password) {
    if(typeof password!=='string' || password.length>4096)throw new Error('Invalid password');
    if(!secureStorageAvailable(this.safeStorage))throw new Error('Secure credential storage unavailable. Unlock your system keyring to save passwords.');
    if(password==='')delete this.secrets[id];
    else this.secrets[id]=this.safeStorage.encryptString(password).toString('base64');
    atomicWrite(this.secretFile,this.secrets);
  }
  readPassword(id) {
    const sealed=this.secrets[id];
    if(!sealed)return '';
    if(!secureStorageAvailable(this.safeStorage))throw new Error('Secure credential storage unavailable. Unlock your system keyring to read saved passwords.');
    return this.safeStorage.decryptString(Buffer.from(sealed,'base64'));
  }
  lookupFingerprint(host,port) {return this.known[host+':'+port]||null;}
  trustFingerprint(host,port,hash) {
    this.known[host+':'+port]={hash,verifiedAt:new Date().toISOString()};
    atomicWrite(this.knownFile,this.known);
  }
}
module.exports={Store, normalizeHost, importLegacyJson, normalizeFolders,normalizeCredential};
