import {useEffect,useState} from 'react';
import {Check,KeyRound,Plus,Save,ShieldCheck,Trash2,ExternalLink} from 'lucide-react';
import type {Credential,VaultServerItem,VaultServerStatus} from '../types';
const explain=(error:unknown)=>error instanceof Error?error.message:String(error);
export default function KeychainSimple({items,onChange}:{
  items:Credential[];onChange:()=>Promise<void>;
}){
  const [selected,setSelected]=useState<Credential|null>(null);
  const [editingExisting,setEditingExisting]=useState(false);
  const [password,setPassword]=useState('');
  const [clearPassword,setClearPassword]=useState(false);
  const [vaultPassword,setVaultPassword]=useState('');
  const [vaultStatus,setVaultStatus]=useState<VaultServerStatus|null>(null);
  const [vaultItems,setVaultItems]=useState<VaultServerItem[]>([]);
  const [busy,setBusy]=useState(false);
  const [vaultBusy,setVaultBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  useEffect(()=>{
    if(editingExisting&&selected&&!items.some(item=>item.Id===selected.Id)){
      setSelected(null);setEditingExisting(false);
      setPassword('');setVaultPassword('');
    }
  },[items,editingExisting,selected]);
  const refreshVault=async()=>{
    setVaultBusy(true);
    try{
      const status=await window.shiro.vaultStatus();
      setVaultStatus(status);
      setVaultItems(status.connected?(await window.shiro.vaultItems()).items:[]);
    }catch(error){setError(explain(error));}
    finally{setVaultBusy(false);}
  };
  useEffect(()=>{
    void refreshVault();
    const unlisten=window.shiro.onSyncRestored(()=>void refreshVault());
    void window.shiro.syncReady().then(state=>{
      if(state.connected)void refreshVault();
    }).catch(()=>{});
    return unlisten;
  },[]);
  const open=(credential:Credential)=>{
    setEditingExisting(true);
    setSelected({...credential});setPassword('');setClearPassword(false);
    setVaultPassword('');setError('');setMessage('');
  };
  const create=()=>{
    setEditingExisting(false);
    setSelected({Id:crypto.randomUUID(),Name:'',User:'',Notes:'',
      VaultItemId:'',HasStoredPassword:false});
    setPassword('');setVaultPassword('');setClearPassword(false);
    setError('');setMessage('');
  };
  const update=(delta:Partial<Credential>)=>
    setSelected(old=>old?{...old,...delta}:old);
  const save=async()=>{
    if(!selected)return;
    if(!selected.Name.trim()||!selected.User.trim()){
      setError('Wpisz nazwę i użytkownika.');return;
    }
    setBusy(true);setError('');setMessage('');
    try{
      const value=await window.shiro.saveCredential({
        ...selected,Name:selected.Name.trim(),User:selected.User.trim()});
      if(password||clearPassword)
        await window.shiro.saveCredentialPassword(value.Id,clearPassword?'':password);
      await onChange();
      setSelected({...value,HasStoredPassword:clearPassword?false:
        !!password||value.HasStoredPassword});
      setPassword('');setClearPassword(false);setEditingExisting(true);
      setMessage('Poświadczenie zapisane.');
    }catch(error){setError(explain(error));}
    finally{setBusy(false);}
  };
  const remove=async()=>{
    if(!selected||!confirm('Usunąć to poświadczenie i odłączyć je od hostów?'))return;
    setBusy(true);setError('');setMessage('');
    try{
      await window.shiro.removeCredential(selected.Id);
      await onChange();
      setSelected(null);setEditingExisting(false);setPassword('');
      setMessage('Poświadczenie usunięte.');
    }catch(error){setError(explain(error));}
    finally{setBusy(false);}
  };
  const saveVaultwarden=async()=>{
    if(!selected||!vaultStatus?.connected||!vaultPassword)return;
    if(!selected.Name.trim()||!selected.User.trim()){
      setError('Uzupełnij nazwę i użytkownika przed zapisem do Vaultwarden.');return;
    }
    const linked=selected.VaultItemId?
      vaultItems.find(item=>item.id===selected.VaultItemId):null;
    if(selected.VaultItemId&&(!linked||linked.organization||!linked.revisionDate)){
      setError('Nie można zmienić tego wpisu. Odśwież Vaultwarden i wybierz osobisty login.');
      return;
    }
    if(!confirm((linked?'Zaktualizować':'Utworzyć')+' login w Vaultwarden dla '+selected.Name+'?'))return;
    setVaultBusy(true);setError('');setMessage('');
    try{
      const body={name:selected.Name.trim(),username:selected.User.trim(),
        password:vaultPassword};
      const result=linked?await window.shiro.vaultUpdateItem({
        ...body,itemId:linked.id,expectedRevision:linked.revisionDate}):
        await window.shiro.vaultCreateItem(body);
      const saved=await window.shiro.saveCredential({...selected,VaultItemId:result.id});
      await onChange();setSelected(saved);setVaultPassword('');
      setVaultItems((await window.shiro.vaultItems()).items);
      setMessage('Hasło zapisane w Vaultwarden na serwerze.');
    }catch(error){setError(explain(error));}
    finally{setVaultBusy(false);}
  };
  return <div className="feature-screen keychain-simple">
    <header className="feature-header">
      <div><h2><KeyRound size={20}/> Keychain</h2>
      </div>
      <button className="primary-button" onClick={create}><Plus size={16}/> Dodaj</button>
    </header>
    <div className="keychain-workspace">
      <aside className="keychain-list">
        <div className="keychain-list-title">Poświadczenia <span>{items.length}</span></div>
        {items.map(item=><button key={item.Id} className={'keychain-entry '+
          (selected?.Id===item.Id?'active':'')} onClick={()=>open(item)}>
          <KeyRound size={16}/>
          <span><strong>{item.Name||item.User}</strong><small>{item.User||'Bez użytkownika'}</small></span>
          {(item.HasStoredPassword||item.VaultItemId)&&<ShieldCheck size={15}/>}
        </button>)}
        {!items.length&&<p className="keychain-empty">Brak zapisanych poświadczeń.</p>}
      </aside>
      <div className="keychain-editor">
        {selected?<div className="keychain-fields">
          <h3>{selected.Name||'Nowe poświadczenie'}</h3>
          <div className="keychain-field-grid">
            <label>Nazwa<input value={selected.Name} maxLength={128}
              placeholder="Administrator" onChange={e=>update({Name:e.target.value})}/></label>
            <label>Użytkownik<input value={selected.User} maxLength={128}
              autoComplete="username" placeholder="root"
              onChange={e=>update({User:e.target.value})}/></label>
          </div>
          <label>Hasło (opcjonalnie)
            <input type="password" autoComplete="new-password" value={password}
              disabled={clearPassword}
              placeholder={selected.HasStoredPassword?'Zapisane — pozostaw puste, aby zachować':'Nowe hasło'}
              onChange={e=>setPassword(e.target.value)}/></label>
          {selected.HasStoredPassword&&<label className="check-row">
            <input type="checkbox" checked={clearPassword}
              onChange={e=>{setClearPassword(e.target.checked);setPassword('');}}/>
            Usuń zapisane lokalnie hasło
          </label>}
          <div className="keychain-buttons">
            <button className="secondary-button danger-action" disabled={busy}
              onClick={()=>void remove()}><Trash2 size={16}/> Usuń</button>
            <button className="primary-button" disabled={busy}
              onClick={()=>void save()}><Save size={16}/> Zapisz</button>
          </div>
          <details className="keychain-advanced">
            <summary>Więcej opcji — Vaultwarden i notatki</summary>
            <div className="keychain-advanced-content">
              <div className="keychain-vault-status">
                <ShieldCheck size={17}/>
                <span>Vaultwarden: {vaultStatus?.connected?
                  'połączony jako '+vaultStatus.account:'nieodblokowany na serwerze'}</span>
                <button className="secondary-button" disabled={vaultBusy}
                  onClick={()=>void refreshVault()}>Odśwież</button>
                <button className="secondary-button" onClick={()=>void window.shiro.syncOpenConsole()}>
                  <ExternalLink size={15}/> Panel serwera</button>
              </div>
              <label>Powiązany wpis Vaultwarden
                <select value={selected.VaultItemId||''}
                  onChange={e=>update({VaultItemId:e.target.value})}>
                  <option value="">Brak powiązania</option>
                  {selected.VaultItemId&&!vaultItems.some(v=>v.id===selected.VaultItemId)&&
                    <option value={selected.VaultItemId}>Wcześniej powiązany wpis</option>}
                  {vaultItems.map(item=><option key={item.id} value={item.id}>
                    {item.name}{item.username?' · '+item.username:''}</option>)}
                </select>
              </label>
              {vaultStatus?.connected&&<div className="keychain-vault-write">
                <label>Hasło do zapisania w Vaultwarden
                  <input type="password" autoComplete="new-password"
                    value={vaultPassword} onChange={e=>setVaultPassword(e.target.value)}/></label>
                <button className="secondary-button"
                  disabled={!vaultPassword||vaultBusy||busy}
                  onClick={()=>void saveVaultwarden()}>
                  {selected.VaultItemId?'Zaktualizuj login':'Utwórz login w Vaultwarden'}
                </button>
              </div>}
              <label>Notatki<textarea value={selected.Notes} rows={3}
                onChange={e=>update({Notes:e.target.value})}/></label>
            </div>
          </details>
        </div>:<div className="keychain-empty-center">
          <KeyRound size={28}/>
          <strong>Wybierz poświadczenie</strong>
        </div>}
        {message&&<div className="save-success" role="status"><Check size={16}/>{message}</div>}
        {error&&<div className="inline-error" role="alert">{error}</div>}
      </div>
    </div>
  </div>;
}
