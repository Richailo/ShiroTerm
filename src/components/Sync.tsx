import {useEffect,useState} from 'react';
import {CloudDownload,CloudUpload,LockKeyhole,ShieldCheck,FolderLock,Plus} from 'lucide-react';
import type {SyncStatus,SyncVersion,VaultServerStatus,ProfileVault} from '../types';
import {readThemePreferences,type TerminalThemePreferences} from '../terminal-themes';
export default function Sync({onDownload}:{onDownload:(themes?:TerminalThemePreferences)=>Promise<void>}){
  const [passphrase,setPassphrase]=useState('');
  const [status,setStatus]=useState<SyncStatus|null>(null);
  const [versions,setVersions]=useState<SyncVersion[]>([]);
  const [restoreRevision,setRestoreRevision]=useState('');
  const [vault,setVault]=useState<VaultServerStatus|null>(null);
  const [profileVaults,setProfileVaults]=useState<ProfileVault[]>([]);
  const [newVaultName,setNewVaultName]=useState('');
  const [vaultBusy,setVaultBusy]=useState(false);
  const [vaultError,setVaultError]=useState('');
  const [vaultMessage,setVaultMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    const refresh=()=>void window.shiro.syncStatus()
      .then(value=>{if(active)setStatus(value);}).catch(()=>{});
    refresh();
    const interval=window.setInterval(refresh,8000);
    return ()=>{active=false;window.clearInterval(interval);};
  },[]);
  useEffect(()=>{
    if(!status?.connected){setProfileVaults([]);return;}
    let active=true;
    void window.shiro.profileVaults().then(items=>{if(active)setProfileVaults(items);})
      .catch(e=>{if(active)setError(String(e));});
    return ()=>{active=false;};
  },[status?.connected,status?.vaultId]);
  useEffect(()=>{
    if(!status?.connected){setVault(null);return;}
    let active=true;
    const refresh=()=>void window.shiro.vaultStatus()
      .then(info=>{if(active){setVault(info);setVaultError('');}})
      .catch(error=>{if(active)setVaultError(String(error));});
    refresh();
    const interval=window.setInterval(refresh,30000);
    return ()=>{active=false;window.clearInterval(interval);};
  },[status?.connected]);
  useEffect(()=>{
    if(!status?.connected){setVersions([]);setRestoreRevision('');return;}
    let active=true;
    void window.shiro.syncHistory().then(list=>{if(active)setVersions(list);}).catch(()=>{});
    return ()=>{active=false;};
  },[status?.connected,status?.revision]);
  const vaultAction=async(fn:()=>Promise<VaultServerStatus>,success:string)=>{
    setVaultBusy(true);setVaultError('');setVaultMessage('');
    try{setVault(await fn());setVaultMessage(success);}
    catch(e){setVaultError(e instanceof Error?e.message:String(e));}
    finally{setVaultBusy(false);}
  };
  const action=async(fn:()=>Promise<SyncStatus>,success:string)=>{
    setBusy(true);setError('');setMessage('');
    try{setStatus(await fn());setMessage(success);}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const selectVault=async(id:string)=>{
    if(id===status?.vaultId)return;
    setBusy(true);setError('');setMessage('');
    try{
      const result=await window.shiro.selectProfileVault(id);
      setStatus(result);setVersions([]);setRestoreRevision('');setPassphrase('');
      await onDownload();
      setMessage('Vault changed. Each vault keeps an independent local profile file.');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const createVault=async()=>{
    if(!newVaultName.trim())return;
    setBusy(true);setError('');setMessage('');
    try{
      const created=await window.shiro.createProfileVault(newVaultName);
      setNewVaultName('');
      setProfileVaults(await window.shiro.profileVaults());
      const result=await window.shiro.selectProfileVault(created.id);
      setStatus(result);setVersions([]);setRestoreRevision('');setPassphrase('');
      await onDownload();
      setMessage('Private vault created. Its profile collection is empty.');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const unlock=()=>void action(async()=>{
    const result=await window.shiro.syncUnlockProfiles(passphrase);
    setPassphrase('');return result;
  },'Profile encryption unlocked locally. The recovery phrase was not sent to the server.');
  const setAuto=()=>void action(()=>window.shiro.syncAutoSet(!status?.autoEnabled),
    status?.autoEnabled?'Automatic synchronization disabled.':
      'Automatic synchronization enabled. Changes will be checked every 45 seconds.');
  const keepLocal=()=>{
    const description=(status?.autoConflicts||[]).slice(0,7)
      .map(c=>c.section+' / '+c.name).join(', ');
    if(!confirm('Overwrite the newer server snapshot with this computer’s current profiles? '+
      'Other devices may lose their changes in: '+description+'\n\nThis cannot be merged automatically.'))return;
    void action(()=>window.shiro.syncResolveLocal(readThemePreferences()),
      'Current computer profiles were explicitly saved to the server.');
  };
  const restore=()=>{
    const revision=Number(restoreRevision);
    if(!Number.isSafeInteger(revision)||revision<1)return;
    if(!confirm('Restore encrypted revision '+revision+' to the server AND replace local profile metadata? '+
      'The current server version will remain in history. A local backup will be created.'))return;
    void action(async()=>{
      const result=await window.shiro.syncRestoreVersion(revision);
      await onDownload(result.themePreferences||undefined);
      setRestoreRevision('');return result;
    },'Historical revision restored to the server and this computer.');
  };
  const upload=()=>{
    const overwrite=!!status?.remoteExists;
    if(overwrite&&!confirm('Replace the encrypted snapshot on the server with this computer’s configuration? This does not merge changes.'))return;
    void action(()=>window.shiro.syncUpload(overwrite,readThemePreferences()),'Encrypted configuration uploaded successfully.');
  };
  const download=()=>{
    if(!confirm('Replace local host, folder, keychain metadata and snippet lists with the server snapshot? A local backup is made. Saved local passwords and private SSH keys are not replaced.'))return;
    void action(async()=>{const result=await window.shiro.syncDownload();await onDownload(result.themePreferences||undefined);return result;},
      'Configuration downloaded and decrypted. Local SSH keys and stored passwords were retained.');
  };
  return <div className="feature-screen">
    <header className="feature-header"><div><h2><FolderLock size={22}/> Vaults</h2>
      <p>Independent encrypted host collections on ShiroTerm Server. Choose a vault before syncing.</p>
      </div></header>
    {status?.connected&&<div className="feature-editor"
      style={{maxWidth:760,margin:'18px',padding:'20px'}}>
      <div className="snippet-form">
        <h3><FolderLock size={18}/> Your vaults</h3>
        <p>Each vault has its own server revision, encrypted snapshot, and local host,
          credential and snippet collection. Existing profiles remain in Personal.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
          {profileVaults.map(item=><button key={item.id}
            className={status.vaultId===item.id?'primary-button':'secondary-button'}
            style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:7,padding:14,
              borderRadius:12,textAlign:'left',minHeight:90}}
            disabled={busy} onClick={()=>void selectVault(item.id)}>
            <span><FolderLock size={16}/> {item.name}</span>
            <small>Revision {item.revision} · {item.kind==='personal'?'Default vault':'Private'}</small>
            {status.vaultId===item.id&&<small>ACTIVE</small>}
          </button>)}
        </div>
        <div className="snippet-actions" style={{marginTop:15}}>
          <input aria-label="New vault name" placeholder="New private vault name"
            maxLength={64} value={newVaultName} disabled={busy}
            onChange={e=>setNewVaultName(e.target.value)}/>
          <button className="secondary-button" disabled={busy||newVaultName.trim().length<2}
            onClick={()=>void createVault()}><Plus size={15}/> Create vault</button>
          <button className="secondary-button" disabled={busy}
            onClick={()=>void window.shiro.profileVaults().then(setProfileVaults).catch(e=>setError(String(e)))}>
            Refresh</button>
        </div>
      </div>
    </div>}
    <div className="feature-editor" style={{maxWidth:760,margin:'18px',padding:'20px'}}>
      <div className="snippet-form">
        {!status?.connected&&<div className="credential-info">
          <ShieldCheck size={18}/> Zaloguj się najpierw w zakładce Sync Server.
          Tutaj znajdują się wyłącznie sejfy i synchronizacja ich profili.
        </div>}
        {status?.connected&&!status.encryptionReady&&<div className="credential-info"
          style={{display:'block'}}>
          <strong>Encrypted profile recovery (optional for server login)</strong>
          <p>Browser authorization is complete. To upload or decrypt synchronized profiles,
            enter your separate encryption/recovery passphrase here. It stays on this PC
            and is never sent to ShiroTerm Server.</p>
          <label>Profile encryption passphrase<input aria-label="Sync encryption passphrase"
            type="password" value={passphrase} autoComplete="off"
            onChange={e=>setPassphrase(e.target.value)}/></label>
          <div className="snippet-actions"><button className="primary-button"
            disabled={busy||passphrase.length<12}
            onClick={unlock}><LockKeyhole size={16}/> Unlock profile encryption</button></div>
        </div>}
        {status?.connected&&<>
          <div className="credential-info"><ShieldCheck size={18}/>
            Connected as <strong>{status.user}</strong> · revision {status.revision}
            · {status.remoteExists?'Remote snapshot exists':'Remote snapshot is empty'}</div>
          <div className="snippet-actions">
            <button className="secondary-button" disabled={busy||!status.remoteExists||!status.encryptionReady}
              onClick={download}><CloudDownload size={16}/> Download to this computer</button>
            <button className="primary-button" disabled={busy||!status.encryptionReady}
              onClick={upload}><CloudUpload size={16}/> Upload from this computer</button>
          </div>
          <div className="credential-info" style={{display:'block'}}>
            <strong>Automatic encrypted profile synchronization</strong>
            <p>Runs every 45 seconds while ShiroTerm is open. It combines edits to different
              records and stops when the same record was changed on two devices.</p>
            {!status.autoReady&&<p>
              First download or upload a snapshot above to establish a safe starting point.
            </p>}
            <div className="snippet-actions">
              <button className={status.autoEnabled?'secondary-button':'primary-button'}
                disabled={busy||!status.encryptionReady||(!status.autoEnabled&&!status.autoReady)}
                onClick={setAuto}>
                {status.autoEnabled?'Disable automatic sync':'Enable automatic sync'}
              </button>
            </div>
            <p>Status: {status.autoState||'off'} · Last check: {status.lastAutoSync?
              new Date(status.lastAutoSync).toLocaleString():'Not yet checked'}</p>
            {status.autoError&&<div className="inline-error" role="alert">
              {status.autoError}</div>}
            {!!status.autoConflicts?.length&&<>
              <p><strong>Conflicting records ({status.autoConflicts.length})</strong></p>
              <ul>{status.autoConflicts.slice(0,20).map(conflict=>
                <li key={conflict.section+conflict.id}>
                  {conflict.section}: {conflict.name}</li>)}</ul>
              <p>Choose a source to resolve the conflict. Download creates a local backup
                and keeps the server version. Keep local overwrites the newer server snapshot.</p>
              <div className="snippet-actions">
                <button className="secondary-button" disabled={busy}
                  onClick={download}>Use server version (backup local)</button>
                <button className="secondary-button" disabled={busy}
                  onClick={keepLocal}>Keep this computer (overwrite server)</button>
              </div>
            </>}
          </div>
          <div className="credential-info" style={{display:'block'}}>
            <strong>Encrypted revision history</strong>
            <p>The server retains up to 15 older encrypted versions per account.
              Restoring a version creates a new revision and keeps the previous one in history.</p>
            <label>Choose an earlier revision
              <select value={restoreRevision} onChange={e=>setRestoreRevision(e.target.value)}>
                <option value="">Select a previous snapshot</option>
                {versions.filter(v=>v.revision!==status.revision).map(v=>
                  <option key={v.revision} value={v.revision}>
                    Revision {v.revision} · {new Date(v.updated*1000).toLocaleString()}
                  </option>)}
              </select>
            </label>
            <button className="secondary-button" disabled={busy||!status.encryptionReady||!restoreRevision}
              onClick={restore}>Restore selected revision</button>
          </div>
        </>}
        <div className="credential-info">
          <LockKeyhole size={18}/> Profile snapshots remain end-to-end encrypted.
          Passwords are handled by ShiroTerm Server via Vaultwarden only while that
          account's vault session is unlocked. Local SSH keys are not synced.
        </div>
        {error&&<div className="inline-error" role="alert">{error}</div>}
        {message&&<div className="save-success" role="status">{message}</div>}
      </div>
    </div>
    {status?.connected&&<div className="feature-editor" style={{maxWidth:640,margin:'18px',padding:'20px'}}>
      <div className="snippet-form">
        <h3>ShiroTerm Server ↔ Vaultwarden</h3>
        <p>Vaultwarden CLI runs exclusively on ShiroTerm Server (LXC 235).
          The desktop communicates only with ShiroTerm Server.</p>
        <div className="credential-info"><ShieldCheck size={18}/>
          {vault?.connected?`Connected as ${vault.account} · ${vault.itemCount} entries`:
            'Vaultwarden account is not connected to this ShiroTerm Server user.'}
        </div>
        {vault?.connected&&<div className="credential-info" style={{display:'block'}}>
          <strong>Automatic server-side synchronization</strong>
          <p>Interval: {vault.syncIntervalSeconds/60} min · vault unlock expires in
            {' '+Math.ceil(vault.expiresInSeconds/60)} min</p>
          <p>Last successful sync: {vault.lastSync?
            new Date(vault.lastSync*1000).toLocaleString():'Not yet synchronized'}</p>
          <p>Last attempt: {vault.lastAttempt?
            new Date(vault.lastAttempt*1000).toLocaleString():'Not yet attempted'}</p>
          {vault.lastError&&<div className="inline-error" role="alert">
            Last sync failed: {vault.lastError}</div>}
          <button className="secondary-button" disabled={vaultBusy}
            onClick={()=>void window.shiro.vaultStatus().then(setVault).catch(e=>setVaultError(String(e)))}>
            Refresh status</button>
        </div>}
        <div className="credential-info"><LockKeyhole size={17}/>
          Vaultwarden credentials and master-password authorization are now entered
          only in the browser-based ShiroTerm Server Console.
        </div>
        <div className="snippet-actions">
          <button className="primary-button" disabled={vaultBusy}
            onClick={()=>void window.shiro.syncOpenConsole()}>
            Open Server Console in browser</button>
        </div>
        {vault?.connected&&<div className="snippet-actions">
          <button className="primary-button" disabled={vaultBusy}
            onClick={()=>void vaultAction(()=>window.shiro.vaultRefresh(),
              'Server synchronized its Vaultwarden cache.')}>Sync now</button>
          <button className="secondary-button" disabled={vaultBusy}
            onClick={()=>{if(confirm('Lock this Vaultwarden session on the server for all connected ShiroTerm devices?'))
              void vaultAction(()=>window.shiro.vaultDisconnect(),
              'Vaultwarden session locked on the server.');}}>Disconnect Vaultwarden</button>
        </div>}
        {vaultError&&<div className="inline-error" role="alert">{vaultError}</div>}
        {vaultMessage&&<div className="save-success" role="status">{vaultMessage}</div>}
      </div>
    </div>}
  </div>;
}
