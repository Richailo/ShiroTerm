export interface Host {
  Id:string; Name:string; Host:string; User:string;
  Protocol:'SSH'|'SFTP'|'RDP'|'TELNET'; Port:number;
  FolderId:string; CredentialId:string; Tags:string; Notes:string; Favorite:boolean;
  KeyFile:string; JumpHost:string; AutoReconnect:boolean;
  HasStoredPassword?:boolean;
  SshKeepAliveSeconds:number;
  DetectedPlatform?:string;DetectedRole?:string;DetectedVersion?:string;
  DetectedAt?:string;PlatformOverride?:string;
}
export interface Folder {Id:string;Name:string;ParentId:string}
export interface Credential {Id:string;Name:string;User:string;Notes:string;VaultItemId?:string;HasStoredPassword?:boolean}
export interface Snippet {Id:string;Name:string;Command:string}
export interface KnownHost {id:string;hash:string;verifiedAt:string}
export interface Profiles {Sessions:Host[];Folders:Folder[];Credentials:Credential[];Macros:Snippet[];imported:boolean}
export interface VaultServerStatus {configured:boolean;connected:boolean;server:string;account:string;lastSync:number;lastAttempt:number;lastError:string;expiresInSeconds:number;itemCount:number;syncIntervalSeconds:number}
export interface VaultServerItem {id:string;name:string;username:string;revisionDate:string;organization:boolean}
export interface VaultWriteResult {id:string;name:string;revisionDate:string}
export interface ProfileVault {id:string;name:string;kind:'personal'|'private';revision:number;updated:number;created:number}
export interface SyncVersion {revision:number;updated:number}
export interface SyncConflict {section:string;id:string;name:string}
export interface SyncStatus {connected:boolean;remembered?:boolean;expiresAt?:number;reconnectAvailable?:boolean;vaultId:string;vaultName:string;encryptionReady:boolean;pairingCode:string;pairingExpiresIn:number;user:string;url:string;revision:number|null;remoteExists:boolean;vaultwarden:string;autoEnabled:boolean;autoReady:boolean;autoState:string;autoError:string;autoConflicts:SyncConflict[];lastAutoSync:number;changedLocal?:boolean;themePreferences?:import('./terminal-themes').TerminalThemePreferences|null}
export interface RemoteFile {name:string;directory:boolean;size:number;mtime:number}
export interface CommanderLocalListing {folder:string;entries:RemoteFile[]}
export interface CommanderProgress {sessionId:string;taskId:string;name:string;bytes:number;total:number;percent:number}
export interface SshEvent {
  type:'status'|'error'|'data'|'verify'|'platform';
  sessionId:string;data?:string;status?:string;message?:string;
  requestId?:string;fingerprint?:string;host?:string;port?:number;
  changed?:boolean;oldFingerprint?:string;
  attempt?:number;maxAttempts?:number;delayMs?:number;
  hostId?:string;platform?:string;role?:string;version?:string;confidence?:number;
}
export interface ActivityRecord {id:string;time:string;type:'status'|'error'|'verify';sessionId:string;host:string;status:string;message:string;changed:boolean}
export interface LocalForwardRule {id:string;sessionId:string;listenPort:number;targetHost:string;targetPort:number}
export interface Session {
  id:string;hostId:string;name:string;protocol:'SSH'|'SFTP'|'TELNET';status:string;
  error?:string;retryAttempt?:number;retryMax?:number;retryDelayMs?:number;
}
export interface ShiroBridge {
  profiles():Promise<Profiles>;
  syncLogin(input:{url:string;username:string;password:string;passphrase:string}):Promise<SyncStatus>;
  syncPairStart(input:{url:string}):Promise<{code:string;expiresIn:number;portalUrl:string;server:string;browserOpened:boolean}>;
  syncPairPoll():Promise<{status:'idle'|'pending'|'approved'|'expired'} & Partial<SyncStatus>>;
  syncPairCancel():Promise<SyncStatus>;
  syncOpenConsole():Promise<void>;
  syncUnlockProfiles(passphrase:string):Promise<SyncStatus>;
  syncStatus():Promise<SyncStatus>;
  syncReady():Promise<SyncStatus>;
  syncReconnect():Promise<SyncStatus>;
  onSyncRestored(callback:(status:SyncStatus)=>void):()=>void;
  profileVaults():Promise<ProfileVault[]>;
  createProfileVault(name:string):Promise<ProfileVault>;
  selectProfileVault(id:string):Promise<SyncStatus>;
  syncLogout():Promise<SyncStatus>;
  syncUpload(replace:boolean,themePreferences?:import('./terminal-themes').TerminalThemePreferences):Promise<SyncStatus>;
  syncDownload():Promise<SyncStatus>;
  syncAutoSet(enabled:boolean):Promise<SyncStatus>;
  syncAutoTick(themes:import('./terminal-themes').TerminalThemePreferences):Promise<SyncStatus>;
  syncResolveLocal(themes:import('./terminal-themes').TerminalThemePreferences):Promise<SyncStatus>;
  syncHistory():Promise<SyncVersion[]>;
  syncRestoreVersion(revision:number):Promise<SyncStatus>;
  vaultStatus():Promise<VaultServerStatus>;
  vaultRefresh():Promise<VaultServerStatus>;
  vaultItems():Promise<{items:VaultServerItem[]}>;
  vaultDisconnect():Promise<VaultServerStatus>;
  vaultCreateItem(input:{name:string;username:string;password:string}):Promise<VaultWriteResult>;
  vaultUpdateItem(input:{itemId:string;name:string;username:string;password:string;expectedRevision:string}):Promise<VaultWriteResult>;
  saveHost(host:Host):Promise<Host>;
  saveCredential(item:Credential):Promise<Credential>;
  removeCredential(id:string):Promise<boolean>;
  saveCredentialPassword(id:string,password:string):Promise<boolean>;
  saveSnippet(item:Snippet):Promise<Snippet>;
  removeSnippet(id:string):Promise<void>;
  listActivity():Promise<ActivityRecord[]>;
  clearActivity():Promise<boolean>;
  listKnownHosts():Promise<KnownHost[]>;
  removeKnownHost(id:string):Promise<void>;
  copyText(text:string):Promise<boolean>;
  readClipboard():Promise<string>;
  removeHost(id:string):Promise<boolean>;
  savePassword(id:string,pw:string):Promise<boolean>;
  selectKey():Promise<string>;
  connect(args:{id:string;password?:string;keyPassphrase?:string;jumpPassphrase?:string;cols?:number;rows?:number;sessionId?:string}):Promise<{sessionId:string}>;
  openRdp(id:string):Promise<{address:string;external:true;client?:string;processId:number|null}>;
  connectTelnet(args:{id:string;sessionId:string}):Promise<{sessionId:string}>;
  write(id:string,data:string):Promise<void>;
  terminalHistory(id:string):string;
  forgetTerminal(id:string):void;
  resize(id:string,cols:number,rows:number):Promise<void>;
  disconnect(id:string):Promise<void>;
  cancelReconnect(id:string):Promise<boolean>;
  trust(id:string,approved:boolean):Promise<boolean>;
  listForwards():Promise<LocalForwardRule[]>;
  startForward(rule:{sessionId:string;listenPort:number;targetHost:string;targetPort:number}):Promise<LocalForwardRule>;
  stopForward(id:string):Promise<boolean>;
  listFiles(id:string,path:string):Promise<RemoteFile[]>;
  commanderHome():Promise<string>;
  commanderLocalList(folder:string):Promise<CommanderLocalListing>;
  commanderTransfer(request:{sessionId:string;direction:'upload'|'download';localFolder:string;remoteDir:string;name:string;overwrite?:boolean}):Promise<{ok:boolean;name:string;total:number}>;
  commanderOpen(request:{sessionId:string;side:'local'|'remote';localFolder:string;
    remoteDir:string;name:string}):Promise<{ok:boolean;opened:boolean;temporary?:boolean}>;
  commanderLocalAction(request:{operation:'mkdir'|'rename'|'delete';folder:string;
    name:string;newName?:string}):Promise<{operation:string;path:string;directory?:boolean}>;
  commanderExternalDrop(request:{sessionId:string;remoteDir:string;paths:string[];
    overwrite?:boolean}):Promise<{ok:boolean;files:number;folders:number;total:number}>;
  commanderFilePath(file:File):string;
  commanderTransferBatch(request:{sessionId:string;direction:'upload'|'download';
    localFolder:string;remoteDir:string;names:string[];overwrite?:boolean}):
    Promise<{ok:boolean;files:number;folders:number;total:number}>;
  onCommanderProgress(callback:(progress:CommanderProgress)=>void):()=>void;
  sftpAction(id:string,request:{operation:'mkdir'|'rename'|'delete';folder:string;
    name:string;newName?:string}):Promise<{operation:string;path:string;directory?:boolean}>;
  transfer(id:string,direction:'download'|'upload',path:string):Promise<{canceled:boolean}>;
  windowAction(action:'minimize'|'toggleMaximize'|'close'):Promise<void>;
  windowState():Promise<{maximized:boolean}>;
  onWindowState(callback:(state:{maximized:boolean})=>void):()=>void;
  onSshEvent(callback:(event:SshEvent)=>void):()=>void;
}
declare global {interface Window{shiro:ShiroBridge}}
