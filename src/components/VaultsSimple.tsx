import {useEffect,useState} from 'react';
import {CloudDownload,CloudUpload,FolderLock,Plus,LockKeyhole,ShieldCheck,RefreshCw} from 'lucide-react';
import type {SyncStatus,SyncVersion,ProfileVault} from '../types';
import {readThemePreferences,type TerminalThemePreferences} from '../terminal-themes';
const describe=(error:unknown)=>error instanceof Error?error.message:String(error);
export default function VaultsSimple({onDownload}:{onDownload:(themes?:TerminalThemePreferences)=>Promise<void>}){
  const [status,setStatus]=useState<SyncStatus|null>(null);
  const [vaults,setVaults]=useState<ProfileVault[]>([]);
  const [versions,setVersions]=useState<SyncVersion[]>([]);
  const [revision,setRevision]=useState('');
  const [phrase,setPhrase]=useState('');
  const [newName,setNewName]=useState('');
  const [creating,setCreating]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const refresh=async()=>{
    const state=await window.shiro.syncStatus();
    setStatus(state);
    if(state.connected){
      const list=await window.shiro.profileVaults();
      setVaults(list);
    }else setVaults([]);
  };
  useEffect(()=>{
    let active=true;
    const check=async()=>{
      try{
        const s=await window.shiro.syncStatus();
        if(!active)return;
        setStatus(s);
        if(s.connected){
          const list=await window.shiro.profileVaults();
          if(active)setVaults(list);
        }else if(active)setVaults([]);
      }catch{/* Keep local display during network interruptions. */}
    };
    void check();
    const timer=setInterval(()=>void check(),12000);
    return()=>{active=false;clearInterval(timer);};
  },[]);
  const perform=async(task:()=>Promise<unknown>,success:string)=>{
    setBusy(true);setError('');setNotice('');
    try{await task();await refresh();setNotice(success);}
    catch(err){setError(describe(err));}
    finally{setBusy(false);}
  };
  const select=async(id:string)=>{
    if(!id||id===status?.vaultId)return;
    await perform(async()=>{
      await window.shiro.selectProfileVault(id);
      setPhrase('');setVersions([]);setRevision('');
      await onDownload();
    },'Sejf przełączony. Lokalne profile są przechowywane osobno.');
  };
  const create=async()=>{
    if(newName.trim().length<2)return;
    await perform(async()=>{
      const next=await window.shiro.createProfileVault(newName.trim());
      setNewName('');setCreating(false);
      await window.shiro.selectProfileVault(next.id);
      setPhrase('');setVersions([]);
      await onDownload();
    },'Nowy sejf został utworzony.');
  };
  const unlock=()=>void perform(async()=>{
    await window.shiro.syncUnlockProfiles(phrase);
    setPhrase('');
  },'Szyfrowanie profili zostało odblokowane.');
  const upload=()=>{
    if(status?.remoteExists&&!confirm('Zastąpić zaszyfrowaną kopię na serwerze danymi z tego komputera?'))return;
    void perform(()=>window.shiro.syncUpload(!!status?.remoteExists,readThemePreferences()),
      'Zaszyfrowana kopia zapisana na serwerze.');
  };
  const download=()=>{
    if(!confirm('Pobrać profile z serwera? Lokalna kopia bezpieczeństwa zostanie utworzona.'))return;
    void perform(async()=>{
      const response=await window.shiro.syncDownload();
      await onDownload(response.themePreferences||undefined);
    },'Profile pobrano z serwera.');
  };
  const restore=()=>{
    const n=Number(revision);
    if(!Number.isSafeInteger(n)||n<1)return;
    if(!confirm('Przywrócić wersję '+n+' do sejfu i zastąpić lokalne profile?'))return;
    void perform(async()=>{
      const response=await window.shiro.syncRestoreVersion(n);
      await onDownload(response.themePreferences||undefined);
      setRevision('');
    },'Wersja została przywrócona.');
  };
  const conflicts=status?.autoConflicts||[];
  return <div className="feature-screen vaults-simple">
    <header className="feature-header"><div>
      <h2><FolderLock size={21}/> Vaults</h2>
    </div></header>
    <div className="vaults-scroll">
      <div className="vaults-content">
        {!status?.connected?<div className="vaults-panel vaults-state">
          <LockKeyhole size={22}/>
          <div><strong>Brak połączenia z serwerem</strong></div>
        </div>:<>
          <div className="vaults-panel">
            <div className="vaults-panel-heading">
              <div><h3>Moje sejfy</h3><p>Aktywny sejf: <strong>{status.vaultName}</strong></p></div>
              <button className="secondary-button" disabled={busy}
                onClick={()=>setCreating(value=>!value)}><Plus size={15}/> Nowy sejf</button>
            </div>
            <div className="vaults-choices">
              {vaults.map(v=><button key={v.id} type="button"
                className={'vaults-choice '+(v.id===status.vaultId?'is-current':'')}
                disabled={busy} onClick={()=>void select(v.id)}>
                <FolderLock size={19}/>
                <span><strong>{v.name}</strong><small>{v.kind==='personal'?'Osobisty':'Prywatny'} · wersja {v.revision}</small></span>
                {v.id===status.vaultId&&<ShieldCheck size={18}/>}
              </button>)}
            </div>
            {creating&&<div className="vaults-create">
              <input aria-label="Nazwa nowego sejfu" value={newName} maxLength={64}
                placeholder="Nazwa nowego sejfu" disabled={busy}
                onChange={e=>setNewName(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter')void create();}}/>
              <button className="primary-button" disabled={busy||newName.trim().length<2}
                onClick={()=>void create()}>Utwórz</button>
            </div>}
          </div>
          <div className="vaults-panel">
            <div className="vaults-panel-heading">
              <div><h3>Synchronizacja</h3>
                <p>{status.user} · {status.remoteExists?'Kopia na serwerze: wersja '+status.revision:'Brak kopii na serwerze'}</p></div>
              <ShieldCheck size={20}/>
            </div>
            {!status.encryptionReady&&<div className="vaults-unlock">
              <label>Hasło szyfrowania profili
                <input type="password" autoComplete="off" value={phrase}
                  placeholder="Osobne hasło do zaszyfrowanej kopii" disabled={busy}
                  onChange={e=>setPhrase(e.target.value)}/></label>
              <button className="primary-button" disabled={busy||phrase.length<12}
                onClick={unlock}><LockKeyhole size={15}/> Odblokuj</button>
              <small>Wymagane tylko do synchronizacji. Hasło nie opuszcza komputera.</small>
            </div>}
            <div className="vaults-actions">
              <button className="primary-button" disabled={busy||!status.encryptionReady}
                onClick={upload}><CloudUpload size={17}/> Zapisz na serwerze</button>
              <button className="secondary-button" disabled={busy||!status.encryptionReady||!status.remoteExists}
                onClick={download}><CloudDownload size={17}/> Pobierz na komputer</button>
            </div>
            {!!conflicts.length&&<div className="inline-error">
              Konflikt zmian ({conflicts.length}). Wybierz wersję w ustawieniach zaawansowanych.
            </div>}
          </div>
          <details className="vaults-advanced" onToggle={e=>{
            if(e.currentTarget.open){
              void window.shiro.syncHistory().then(setVersions).catch(err=>setError(describe(err)));
            }
          }}>
            <summary>Zaawansowane: automatyczna synchronizacja i historia wersji</summary>
            <div className="vaults-advanced-body">
              <div className="vaults-setting-row">
                <div><strong>Automatyczna synchronizacja</strong></div>
                <button className="secondary-button" disabled={busy||!status.encryptionReady||(!status.autoEnabled&&!status.autoReady)}
                  onClick={()=>void perform(()=>window.shiro.syncAutoSet(!status.autoEnabled),
                    status.autoEnabled?'Automatyczna synchronizacja wyłączona.':'Automatyczna synchronizacja włączona.')}>
                  {status.autoEnabled?'Wyłącz':'Włącz'}
                </button>
              </div>
              <div className="vaults-setting-row">
                <div><strong>Poprzednie wersje</strong></div>
                <select aria-label="Wybierz poprzednią wersję" value={revision}
                  onChange={e=>setRevision(e.target.value)}>
                  <option value="">Wybierz wersję</option>
                  {versions.filter(v=>v.revision!==status.revision).map(v=>
                    <option key={v.revision} value={v.revision}>Wersja {v.revision} · {new Date(v.updated*1000).toLocaleString()}</option>)}
                </select>
                <button className="secondary-button" disabled={busy||!revision||!status.encryptionReady}
                  onClick={restore}>Przywróć</button>
              </div>
              {!!conflicts.length&&<div className="vaults-setting-row">
                <p>Zmiany na serwerze i komputerze są sprzeczne.</p>
                <button className="secondary-button" disabled={busy}
                  onClick={download}>Zachowaj wersję z serwera</button>
                <button className="secondary-button" disabled={busy}
                  onClick={()=>{
                    if(!confirm('Nadpisać nowsze zmiany na serwerze danymi z tego komputera?'))return;
                    void perform(()=>window.shiro.syncResolveLocal(readThemePreferences()),
                      'Zachowano lokalną wersję.');
                  }}>Zachowaj lokalną</button>
              </div>}
              {status.autoError&&<p className="inline-error">{status.autoError}</p>}
            </div>
          </details>
        </>}
        {error&&<div role="alert" className="inline-error">{error}</div>}
        {notice&&<div role="status" className="save-success">{notice}</div>}
      </div>
    </div>
  </div>;
}
