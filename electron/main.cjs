'use strict';
const {app,BrowserWindow,ipcMain,safeStorage,dialog,session,clipboard,shell}=require('electron');
const path=require('node:path');
const {Store}=require('./storage.cjs');
const {SyncClient}=require('./sync.cjs');
const {Connections}=require('./ssh.cjs');
const fileCommander=require('./file-commander.cjs');
const sftpEditor=require('./commander-editor.cjs');
const {LocalForwarding}=require('./forwarding.cjs');
const {Activity}=require('./activity.cjs');
const {TelnetConnections}=require('./telnet.cjs');
const {launch:launchRdp,checkReachability:checkRdpReachability}=require('./rdp.cjs');
const activity=new Activity();
let win,store,connections,telnet,forwarding,sync;
app.setName('ShiroTerm Next');
if(process.argv.includes('--shiro-smoke') && process.env.SHIROTERM_TEST_USER_DATA)
  app.setPath('userData',process.env.SHIROTERM_TEST_USER_DATA);
if(process.platform==='win32')app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
const limited = (s,max=128) => typeof s==='string' && s.length<=max;
function createWindow() {
  win=new BrowserWindow({
    width:1380,height:850,minWidth:900,minHeight:600,
    show:false,backgroundColor:'#1b2032',frame:false,
    icon:path.join(__dirname,'..','assets',process.platform==='win32'?'shiroterm.ico':'shiroterm.png'),
    resizable:true,maximizable:true,
    autoHideMenuBar:true,
    webPreferences:{
      preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,
      contextIsolation:true,sandbox:false,webSecurity:true
    }
  });
  const dev=process.argv.includes('--dev');
  if(dev)win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname,'..','dist','index.html'));
  win.once('ready-to-show',()=>win.show());
  const reportWindowState=()=>{
    if(!win?.isDestroyed())win.webContents.send('window:state-changed',{
      maximized:win.isMaximized()
    });
  };
  win.on('maximize',reportWindowState);
  win.on('unmaximize',reportWindowState);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{
    if(!url.startsWith('file://') && !url.startsWith('http://127.0.0.1:5173/'))
      event.preventDefault();
  });
  connections=new Connections(win,store,activity);
  telnet=new TelnetConnections(win,store,activity);
  forwarding=new LocalForwarding(id=>connections.sessions.get(id));
  win.on('closed',()=>{forwarding?.stopAll();connections?.closeAll();telnet?.closeAll();win=null;});
}
app.whenReady().then(()=>{
  session.defaultSession.setPermissionRequestHandler((_web,permission,callback)=>callback(false));
  store=new Store(app.getPath('userData'),safeStorage);
  sync=new SyncClient(store);
  sync.onRestored=state=>{
    if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())
      win.webContents.send('sync:restored',state);
  };
  // Restore the paired device without blocking the first window paint.
  // Retry after offline starts; only OS-protected device tokens are considered.
  void sync.restoreSession().catch(()=>{});
  const rememberTimer=setInterval(()=>{
    if(!sync.token&&!sync.pairing)void sync.restoreSession().catch(()=>{});
  },60000);
  rememberTimer.unref?.();
  app.once('before-quit',()=>clearInterval(rememberTimer));
  ipcMain.handle('vault:status',()=>sync.vaultStatus());
  ipcMain.handle('vault:refresh',()=>sync.vaultSync());
  ipcMain.handle('vault:items',()=>sync.vaultItems());
  ipcMain.handle('vault:disconnect',()=>sync.vaultDisconnect());
  ipcMain.handle('vault:item-create',(_event,input)=>sync.vaultCreateItem(input));
  ipcMain.handle('vault:item-update',(_event,input)=>sync.vaultUpdateItem(input));
  ipcMain.handle('sync:login',(_event,input)=>sync.login(input));
  ipcMain.handle('sync:pair-start',async(_event,input)=>{
    const label='ShiroTerm · '+require('node:os').hostname().slice(0,35);
    const result=await sync.pairStart({...input,label});
    let browserOpened=true;
    try{
      const portal=new URL(result.portalUrl);
      portal.searchParams.set('code',result.code);
      await shell.openExternal(portal.href);
    }
    catch{browserOpened=false;}
    return {...result,browserOpened};
  });
  ipcMain.handle('sync:pair-poll',()=>sync.pairPoll());
  ipcMain.handle('sync:pair-cancel',()=>sync.cancelPairing());
  ipcMain.handle('sync:open-console',()=>shell.openExternal(sync.consoleUrl()));
  ipcMain.handle('sync:unlock',(_event,passphrase)=>sync.unlockProfiles(passphrase));
  ipcMain.handle('sync:status',()=>sync.status());
  ipcMain.handle('sync:reconnect',async()=>{
    await sync.restoreSession();
    return sync.status();
  });
  ipcMain.handle('sync:ready',async()=>{
    if(sync.restoreBusy)await sync.restoreBusy;
    return sync.status();
  });
  ipcMain.handle('vaults:list',()=>sync.listProfileVaults());
  ipcMain.handle('vaults:create',(_event,name)=>sync.createProfileVault(name));
  ipcMain.handle('vaults:select',async(_event,id)=>{
    if(connections.sessions.size||telnet.sessions.size)
      throw Error('Disconnect SSH / Telnet sessions before switching vaults');
    return sync.selectProfileVault(id);
  });
  ipcMain.handle('sync:logout',()=>sync.signOut());
  ipcMain.handle('sync:upload',(_event,replace,themes)=>sync.upload(replace===true,themes));
  ipcMain.handle('sync:download',()=>sync.download());
  ipcMain.handle('sync:auto-set',(_event,enabled)=>sync.setAuto(enabled));
  ipcMain.handle('sync:auto-tick',(_event,themes)=>sync.autoTick(themes));
  ipcMain.handle('sync:resolve-local',(_event,themes)=>sync.resolveKeepLocal(themes));
  ipcMain.handle('sync:history',()=>sync.history());
  ipcMain.handle('sync:restore',(_event,revision)=>sync.restoreVersion(revision));
  ipcMain.handle('profiles:list',()=>store.list());
  ipcMain.handle('profiles:save',(_event,record)=>store.saveHost(record));
  ipcMain.handle('credentials:save',(_event,record)=>store.saveCredential(record));
  ipcMain.handle('credentials:remove',(_event,id)=>{store.removeCredential(id);return true;});
  ipcMain.handle('credentials:password',(_event,id,password)=>{
    store.saveCredentialPassword(id,password);return true;
  });
  ipcMain.handle('profiles:remove',(_event,id)=>{
    if(!limited(id,100))throw new Error('Invalid id');
    store.removeHost(id);return true;
  });
  ipcMain.handle('snippets:save',(_event,snippet)=>store.saveSnippet(snippet));
  ipcMain.handle('snippets:remove',(_event,id)=>store.removeSnippet(id));
  ipcMain.handle('activity:list',()=>activity.list());
  ipcMain.handle('activity:clear',()=>activity.clear());
  ipcMain.handle('known:list',()=>store.knownHosts());
  ipcMain.handle('known:remove',(_event,id)=>store.removeKnownHost(id));
  ipcMain.handle('clipboard:write',(_event,text)=>{
    if(typeof text!=='string'||text.length>8*1024*1024)throw new Error('Invalid clipboard text');
    clipboard.writeText(text);return true;
  });
  ipcMain.handle('clipboard:read',()=>{
    const text=clipboard.readText('clipboard');
    if(typeof text!=='string'||text.length>1024*1024)
      throw new Error('Clipboard text is too large to paste (1 MB limit).');
    return text;
  });
  ipcMain.handle('password:save',(_event,id,password)=>{
    if(!limited(id,100))throw new Error('Invalid host id');
    store.savePassword(id,password);return true;
  });
  ipcMain.handle('key:pick',async()=>{
    const result=await dialog.showOpenDialog(win,{
      title:'Select SSH private key',properties:['openFile'],
      filters:[{name:'SSH keys',extensions:['pem','key','ppk','*']}]
    });
    return result.canceled?'':result.filePaths[0];
  });
  ipcMain.handle('ssh:connect',async(_event,args)=>{
    if(!args?.password){
      const host=store.config.Sessions.find(h=>h.Id===args?.id);
      const item=store.config.Credentials.find(c=>c.Id===host?.CredentialId);
      if(item?.VaultItemId)args={...args,password:await sync.vaultPassword(item.VaultItemId)};
    }
    return connections.connect(args);
  });
  ipcMain.handle('rdp:launch',async(_event,id)=>{
    if(!limited(id,100))throw new Error('Invalid RDP host ID');
    const host=store.config.Sessions.find(h=>h.Id===id);
    if(!host||host.Protocol!=='RDP')throw new Error('RDP profile was not found');
    await checkRdpReachability(host);
    return launchRdp(host);
  });
  ipcMain.handle('telnet:connect',(_event,args)=>telnet.connect(args));
  ipcMain.handle('ssh:write',(_event,id,data)=>{
    if(telnet.sessions.has(id))return telnet.write(id,data);
    return connections.write(id,data);
  });
  ipcMain.handle('ssh:resize',(_event,id,cols,rows)=>{
    if(telnet.sessions.has(id))return;
    return connections.resize(id,cols,rows);
  });
  ipcMain.handle('ssh:disconnect',(_event,id)=>{
    if(telnet.sessions.has(id))return telnet.disconnect(id);
    return connections.disconnect(id);
  });
  ipcMain.handle('ssh:cancel-reconnect',(_event,id)=>connections.cancelReconnect(id));
  ipcMain.handle('ssh:trust',(_event,id,accept)=>connections.acceptHost(id,accept));
  ipcMain.handle('forward:list',()=>forwarding.list());
  ipcMain.handle('forward:start',(_event,data)=>forwarding.start(data));
  ipcMain.handle('forward:stop',(_event,id)=>forwarding.stop(id));
  ipcMain.handle('sftp:list',(_event,id,remotePath)=>connections.list(id,remotePath));
  ipcMain.handle('commander:home',()=>require('node:os').homedir());
  ipcMain.handle('commander:local-list',(_event,folder)=>fileCommander.listLocal(folder));
  ipcMain.handle('commander:local-action',(_event,request)=>fileCommander.manageLocal(request));
  ipcMain.handle('commander:open',(_event,request)=>sftpEditor.openFile({
    connections,shell,dialog,win,...request}));
  ipcMain.handle('commander:external-drop',async(_event,request)=>{
    const sender=_event.sender;
    const {sessionId,remoteDir,paths,overwrite}=request||{};
    return require('./commander-batch.cjs').transferExternal({connections,sessionId,
      remoteDir,paths,overwrite:overwrite===true,onProgress:progress=>{
        if(!sender.isDestroyed())sender.send('commander:progress',{sessionId,...progress});
      }});
  });
  ipcMain.handle('commander:batch',async(_event,request)=>{
    const sender=_event.sender;
    const {sessionId,direction,localFolder,remoteDir,names,overwrite}=request||{};
    return require('./commander-batch.cjs').transferBatch({connections,sessionId,
      direction,localFolder,remoteDir,names,overwrite:overwrite===true,
      onProgress:progress=>{
        if(!sender.isDestroyed())sender.send('commander:progress',{sessionId,...progress});
      }});
  });
  ipcMain.handle('commander:transfer',async(_event,request)=>{
    const sender=_event.sender;
    const {sessionId,direction,localFolder,remoteDir,name,overwrite}=request||{};
    return fileCommander.transfer({connections,sessionId,direction,localFolder,remoteDir,name,
      overwrite:overwrite===true,onProgress:progress=>{
        if(!sender.isDestroyed())sender.send('commander:progress',{sessionId,...progress});
      }});
  });
  ipcMain.handle('sftp:action',(_event,id,request)=>connections.manageSftp(id,request));
  ipcMain.handle('sftp:transfer',(_event,id,direction,remotePath)=>
    connections.transfer(id,direction,remotePath));
  ipcMain.handle('window:state',()=>({maximized:!!win?.isMaximized()}));
  ipcMain.handle('window:action',(_event,action)=>{
    if(!win)return;
    if(action==='minimize')win.minimize();
    if(action==='toggleMaximize')win.isMaximized()?win.unmaximize():win.maximize();
    if(action==='close')win.close();
  });
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('before-quit',()=>sftpEditor.closeAll());
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
