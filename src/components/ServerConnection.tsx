import {useEffect,useState} from 'react';
import {Cloud,ExternalLink,LogIn,LogOut,ShieldCheck} from 'lucide-react';
import type {SyncStatus} from '../types';
type Pairing={code:string;expiresIn:number;portalUrl:string;browserOpened:boolean};
export default function ServerConnection(){
  const [url,setUrl]=useState('');
  const [status,setStatus]=useState<SyncStatus|null>(null);
  const [pairing,setPairing]=useState<Pairing|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  useEffect(()=>{
    let alive=true;
    const refresh=()=>void window.shiro.syncStatus().then(s=>{
      if(alive){setStatus(s);if(s.url)setUrl(current=>current||s.url);if(s.connected)setPairing(null);}
    }).catch(e=>{if(alive)setError(String(e));});
    refresh();
    const timer=window.setInterval(refresh,6000);
    return ()=>{alive=false;window.clearInterval(timer);};
  },[]);
  useEffect(()=>{
    if(status?.connected||!(pairing?.code||status?.pairingCode))return;
    let alive=true,working=false;
    const poll=async()=>{
      if(!alive||working)return;
      working=true;
      try{
        const result=await window.shiro.syncPairPoll();
        if(!alive)return;
        if(result.status==='pending')setError('');
        if(result.status==='approved'){
          setPairing(null);setError('');
          setStatus(await window.shiro.syncStatus());
          setMessage('Połączono tę instalację z ShiroTerm Server.');
        }else if(result.status==='idle'||result.status==='expired'){
          setPairing(null);
          setStatus(await window.shiro.syncStatus());
          setMessage(result.status==='expired'?
            'Kod parowania wygasł. Wybierz Zaloguj przez przeglądarkę, aby uzyskać nowy.':'');
        }
      }catch(e){
        if(alive){
          // Network problems must not erase the active pairing code.
          setError('Nie udało się sprawdzić parowania: '+(e instanceof Error?e.message:String(e)));
        }
      }finally{working=false;}
    };
    void poll();
    const timer=window.setInterval(()=>void poll(),3000);
    return ()=>{alive=false;window.clearInterval(timer);};
  },[status?.connected,status?.pairingCode,pairing?.code]);
  const connect=async()=>{
    setBusy(true);setError('');setMessage('');
    try{
      const result=await window.shiro.syncPairStart({url});
      setPairing(result);
      setMessage(result.browserOpened?'Zaloguj się w przeglądarce i zatwierdź kod.':
        'Otwórz panel WWW i zatwierdź poniższy kod.');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const reconnect=async()=>{
    setBusy(true);setError('');setMessage('');
    try{
      const next=await window.shiro.syncReconnect();
      setStatus(next);
      if(next.connected)setMessage('Połączenie z zapamiętanym urządzeniem zostało przywrócone.');
      else setError('Nie można teraz połączyć się z serwerem. Zapamiętane logowanie zostało zachowane.');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const cancel=async()=>{
    setBusy(true);setError('');setMessage('');
    try{
      setStatus(await window.shiro.syncPairCancel());
      setPairing(null);setMessage('Parowanie anulowane. Możesz rozpocząć nowe.');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const logout=async()=>{
    if(!confirm('Wylogować tę instalację ShiroTerm z serwera?'))return;
    setBusy(true);setError('');setMessage('');
    try{
      setStatus(await window.shiro.syncLogout());setPairing(null);
      setMessage('Wylogowano tę instalację.');
    }catch(e){
      setStatus(await window.shiro.syncStatus().catch(()=>null));
      setError(e instanceof Error?e.message:String(e));
    }finally{setBusy(false);}
  };
  return <div className="feature-screen server-connection-screen">
    <header className="feature-header"><div>
      <h2><Cloud size={22}/> Sync Server</h2>
      <p>Opcjonalna synchronizacja. Hosty i terminal działają również bez serwera.</p>
    </div></header>
    <div className="feature-editor server-connection-card">
      <div className="snippet-form server-connection-form">
        <label className="server-address-field">Adres serwera
          <input aria-label="Server address" placeholder="https://sync.example.com" value={url}
            disabled={busy||!!status?.connected}
            onChange={e=>setUrl(e.target.value)}/>
        </label>
        {status?.connected?<>
          <div className="credential-info server-connected-status"><ShieldCheck size={19}/>
            <span>Połączono jako <strong>{status.user}</strong>
              {status.remembered&&<small className="remembered-session">
                Urządzenie zapamiętane do {status.expiresAt?
                  new Date(status.expiresAt*1000).toLocaleDateString('pl-PL'):'następnego wylogowania'}
              </small>}
              {!status.remembered&&<small className="remembered-session">
                Nie można zapamiętać logowania. Odblokuj systemowy magazyn kluczy, a następnie połącz urządzenie ponownie.
              </small>}
            </span>
          </div>
          <div className="snippet-actions server-connection-actions">
            <button className="secondary-button" onClick={()=>void window.shiro.syncOpenConsole()}>
              <ExternalLink size={16}/> Otwórz panel serwera</button>
            <button className="secondary-button" disabled={busy}
              onClick={()=>void logout()}><LogOut size={16}/> Wyloguj</button>
          </div>
        </>:<>
          {status?.reconnectAvailable&&<div className="credential-info server-remember-pending">
            <ShieldCheck size={18}/>
            <span>Urządzenie jest zapamiętane. ShiroTerm automatycznie ponowi połączenie; lokalne hosty są dostępne przez cały czas.</span>
            <button className="secondary-button" disabled={busy} onClick={()=>void reconnect()}>
              Połącz ponownie
            </button>
          </div>}
          <div className="server-connection-actions">
            <button className="primary-button" disabled={busy||!url.trim()||!!pairing||!!status?.pairingCode}
              onClick={()=>void connect()}><LogIn size={16}/> Zaloguj przez przeglądarkę</button>
          </div>
          {(pairing?.code||status?.pairingCode)&&<div className="credential-info server-pairing-card">
            <strong>Kod autoryzacji urządzenia</strong>
            <div className="server-pairing-code">{pairing?.code||status?.pairingCode}</div>
            <p>Zatwierdź ten kod w panelu WWW. Połączenie zostanie nawiązane automatycznie.</p>
            <div className="snippet-actions server-connection-actions">
              <button className="secondary-button" onClick={()=>void window.shiro.syncOpenConsole()}>
                <ExternalLink size={16}/> Otwórz panel WWW</button>
              <button className="secondary-button" disabled={busy} onClick={()=>void cancel()}>
                Anuluj parowanie</button>
            </div>
          </div>}
          <p className="credential-info server-security-note">Zaloguj się raz w przeglądarce. ShiroTerm zapamięta urządzenie w systemowym magazynie i połączy się przy kolejnych uruchomieniach. Hasło szyfrowania kopii profili pozostaje oddzielne.</p>
        </>}
        {error&&<div className="inline-error" role="alert">{error}</div>}
        {message&&<div className="save-success" role="status">{message}</div>}
      </div>
    </div>
  </div>;
}
