'use strict';
const {contextBridge,ipcRenderer,webUtils}=require('electron');
const invoke=(name,...args)=>ipcRenderer.invoke(name,...args);
const history=new Map();
ipcRenderer.on('ssh:event',(_event,payload)=>{
  if(!payload || typeof payload.sessionId!=='string')return;
  if(payload.type==='data' && typeof payload.data==='string'){
    const text=(history.get(payload.sessionId)||'')+payload.data;
    history.set(payload.sessionId,text.length>262144?text.slice(-262144):text);
  }
});
contextBridge.exposeInMainWorld('shiro',{
  profiles:()=>invoke('profiles:list'),
  syncLogin:input=>invoke('sync:login',input),
  syncPairStart:input=>invoke('sync:pair-start',input),
  syncPairPoll:()=>invoke('sync:pair-poll'),
  syncPairCancel:()=>invoke('sync:pair-cancel'),
  syncOpenConsole:()=>invoke('sync:open-console'),
  syncUnlockProfiles:passphrase=>invoke('sync:unlock',passphrase),
  syncStatus:()=>invoke('sync:status'),
  syncCertificateInfo:input=>invoke('sync:certificate-info',input),
  syncCertificateImport:input=>invoke('sync:certificate-import',input),
  syncCertificateRemove:input=>invoke('sync:certificate-remove',input),
  syncReady:()=>invoke('sync:ready'),
  syncReconnect:()=>invoke('sync:reconnect'),
  onSyncRestored:listener=>{
    const fn=(_event,status)=>listener(status);
    ipcRenderer.on('sync:restored',fn);
    return ()=>ipcRenderer.removeListener('sync:restored',fn);
  },
  profileVaults:()=>invoke('vaults:list'),
  createProfileVault:name=>invoke('vaults:create',name),
  selectProfileVault:id=>invoke('vaults:select',id),
  syncLogout:()=>invoke('sync:logout'),
  syncUpload:(replace,themes)=>invoke('sync:upload',replace,themes),
  syncDownload:()=>invoke('sync:download'),
  syncAutoSet:enabled=>invoke('sync:auto-set',enabled),
  syncAutoTick:themes=>invoke('sync:auto-tick',themes),
  syncResolveLocal:themes=>invoke('sync:resolve-local',themes),
  syncHistory:()=>invoke('sync:history'),
  syncRestoreVersion:revision=>invoke('sync:restore',revision),
  vaultStatus:()=>invoke('vault:status'),
  vaultRefresh:()=>invoke('vault:refresh'),
  vaultItems:()=>invoke('vault:items'),
  vaultDisconnect:()=>invoke('vault:disconnect'),
  vaultCreateItem:input=>invoke('vault:item-create',input),
  vaultUpdateItem:input=>invoke('vault:item-update',input),
  saveHost:host=>invoke('profiles:save',host),
  saveCredential:credential=>invoke('credentials:save',credential),
  removeCredential:id=>invoke('credentials:remove',id),
  saveCredentialPassword:(id,password)=>invoke('credentials:password',id,password),
  saveSnippet:snippet=>invoke('snippets:save',snippet),
  removeSnippet:id=>invoke('snippets:remove',id),
  listActivity:()=>invoke('activity:list'),
  clearActivity:()=>invoke('activity:clear'),
  listKnownHosts:()=>invoke('known:list'),
  removeKnownHost:id=>invoke('known:remove',id),
  copyText:text=>invoke('clipboard:write',text),
  readClipboard:()=>invoke('clipboard:read'),
  removeHost:id=>invoke('profiles:remove',id),
  savePassword:(id,password)=>invoke('password:save',id,password),
  selectKey:()=>invoke('key:pick'),
  connect:args=>invoke('ssh:connect',args),
  openRdp:id=>invoke('rdp:launch',id),
  connectTelnet:args=>invoke('telnet:connect',args),
  write:(id,data)=>invoke('ssh:write',id,data),
  terminalHistory:id=>history.get(id)||'',
  forgetTerminal:id=>history.delete(id),
  resize:(id,cols,rows)=>invoke('ssh:resize',id,cols,rows),
  disconnect:id=>invoke('ssh:disconnect',id),
  cancelReconnect:id=>invoke('ssh:cancel-reconnect',id),
  trust:(id,approve)=>invoke('ssh:trust',id,approve),
  listForwards:()=>invoke('forward:list'),
  startForward:data=>invoke('forward:start',data),
  stopForward:id=>invoke('forward:stop',id),
  listFiles:(id,p)=>invoke('sftp:list',id,p),
  commanderHome:()=>invoke('commander:home'),
  commanderLocalList:folder=>invoke('commander:local-list',folder),
  commanderLocalAction:request=>invoke('commander:local-action',request),
  commanderOpen:request=>invoke('commander:open',request),
  commanderTransfer:request=>invoke('commander:transfer',request),
  commanderTransferBatch:request=>invoke('commander:batch',request),
  commanderExternalDrop:request=>invoke('commander:external-drop',request),
  commanderFilePath:file=>webUtils.getPathForFile(file),
  onCommanderProgress:listener=>{
    const fn=(_event,value)=>listener(value);
    ipcRenderer.on('commander:progress',fn);
    return ()=>ipcRenderer.removeListener('commander:progress',fn);
  },
  sftpAction:(id,request)=>invoke('sftp:action',id,request),
  transfer:(id,direction,p)=>invoke('sftp:transfer',id,direction,p),
  windowAction:action=>invoke('window:action',action),
  windowState:()=>invoke('window:state'),
  onWindowState:listener=>{
    const fn=(_event,payload)=>listener(payload);
    ipcRenderer.on('window:state-changed',fn);
    return ()=>ipcRenderer.removeListener('window:state-changed',fn);
  },
  onSshEvent:listener=>{
    const fn=(_event,payload)=>listener(payload);
    ipcRenderer.on('ssh:event',fn);
    return ()=>ipcRenderer.removeListener('ssh:event',fn);
  }
});
