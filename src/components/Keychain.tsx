import {useEffect,useState} from 'react';
import {Check,KeyRound,Plus,Save,ShieldCheck,Trash2,UserRound} from 'lucide-react';
import type {Credential,VaultServerItem,VaultServerStatus} from '../types';

export default function Keychain({items,onChange}:{
  items:Credential[];
  onChange:()=>Promise<void>;
}){
  const [selected,setSelected]=useState<Credential|null>(null);
  const [vaultState,setVaultState]=useState<VaultServerStatus|null>(null);
  const [vaultItems,setVaultItems]=useState<VaultServerItem[]>([]);
  const [vaultError,setVaultError]=useState('');
  const [vaultBusy,setVaultBusy]=useState(false);
  const [vaultWritePassword,setVaultWritePassword]=useState('');
  const reloadVault=async(sync=false)=>{
    setVaultBusy(true);setVaultError('');
    try{
      const state=sync?await window.shiro.vaultRefresh():await window.shiro.vaultStatus();
      setVaultState(state);
      setVaultItems(state.connected?(await window.shiro.vaultItems()).items:[]);
    }catch(e){setVaultError(e instanceof Error?e.message:String(e));}
    finally{setVaultBusy(false);}
  };
  useEffect(()=>{void reloadVault();},[]);
  const [password,setPassword]=useState('');
  const [clearPassword,setClearPassword]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [saved,setSaved]=useState(false);
  const update=(value:Partial<Credential>)=>setSelected(old=>old?{...old,...value}:old);
  const open=(credential:Credential)=>{
    setSelected({...credential});setPassword('');setVaultWritePassword('');setClearPassword(false);
    setError('');setSaved(false);
  };
  const create=()=>open({Id:crypto.randomUUID(),Name:'',User:'',Notes:'',VaultItemId:'',HasStoredPassword:false});
  const writeToVault=async()=>{
    if(!selected||!vaultState?.connected)return;
    if(!selected.Name.trim()||!selected.User.trim()){
      setVaultError('Enter a credential name and username first.');return;
    }
    if(!vaultWritePassword){setVaultError('Enter the password to save in Vaultwarden.');return;}
    const linked=selected.VaultItemId?
      vaultItems.find(item=>item.id===selected.VaultItemId):undefined;
    if(selected.VaultItemId&&(!linked||linked.organization||!linked.revisionDate)){
      setVaultError('This item cannot be modified. Refresh the vault and choose a personal login item.');return;
    }
    const updating=!!selected.VaultItemId;
    const verb=updating?'Overwrite the password in the selected Vaultwarden item':
      'Create a new personal login item in Vaultwarden';
    if(!confirm(verb+' for '+selected.Name+'?'))return;
    setVaultBusy(true);setVaultError('');
    try{
      const request={name:selected.Name.trim(),username:selected.User.trim(),
        password:vaultWritePassword};
      const result=updating?
        await window.shiro.vaultUpdateItem({...request,itemId:selected.VaultItemId!,
          expectedRevision:linked!.revisionDate}):
        await window.shiro.vaultCreateItem(request);
      setVaultWritePassword('');
      const savedCredential=await window.shiro.saveCredential({...selected,VaultItemId:result.id});
      setSelected(savedCredential);
      await onChange();
      setVaultItems((await window.shiro.vaultItems()).items);
      setSaved(true);
    }catch(e){setVaultError(e instanceof Error?e.message:String(e));}
    finally{setVaultBusy(false);}
  };
  const submit=async()=>{
    if(!selected)return;
    if(!selected.Name.trim()){setError('Enter a credential label.');return;}
    if(!selected.User.trim()){setError('Enter a username.');return;}
    setBusy(true);setError('');setSaved(false);
    try{
      const result=await window.shiro.saveCredential({...selected,Name:selected.Name.trim(),User:selected.User.trim()});
      if(password||clearPassword)await window.shiro.saveCredentialPassword(result.Id,clearPassword?'':password);
      await onChange();
      setSelected({...result,HasStoredPassword:clearPassword?false:!!password||result.HasStoredPassword});
      setPassword('');setClearPassword(false);setSaved(true);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const remove=async()=>{
    if(!selected)return;
    if(!confirm('Remove this credential and disconnect it from its hosts?'))return;
    setBusy(true);setError('');
    try{
      await window.shiro.removeCredential(selected.Id);
      await onChange();setSelected(null);setPassword('');
    }catch(e){setError(String(e));}
    finally{setBusy(false);}
  };
  return <div className="feature-screen">
    <header className="feature-header"><div>
      <h2>Keychain</h2>
      <p>Shared SSH credentials encrypted with this account's system keyring.</p>
    </div><button className="primary-button" onClick={create}><Plus size={17}/> Add credential</button></header>
    <div className="credential-info" style={{margin:'12px 18px',maxWidth:830}}>
      <ShieldCheck size={18}/>
      <div><strong>Vaultwarden via ShiroTerm Server</strong> —
        {vaultState?.connected?' connected as '+vaultState.account:' not connected'}
        <p style={{fontSize:12}}>Bitwarden CLI runs on LXC 235 only.
          Log in to ShiroTerm Server through Sync Server, then unlock Vaultwarden
          in its browser console. Passwords are fetched only when needed for SSH;
          they are never copied into synchronized profiles.</p>
        <button className="secondary-button" disabled={vaultBusy}
          onClick={()=>void reloadVault(vaultState?.connected)}>Refresh Vaultwarden via server</button>
        {vaultError&&<div className="inline-error">{vaultError}</div>}
      </div>
    </div>
    <div className="feature-columns">
      <div className="feature-list">
        {items.map(credential=><button key={credential.Id}
          className={'feature-item '+(selected?.Id===credential.Id?'active':'')}
          onClick={()=>open(credential)}>
          <KeyRound size={18}/><span>{credential.Name||credential.User}</span>
          {credential.HasStoredPassword&&<ShieldCheck size={15} className="stored-icon"/>}
        </button>)}
        {!items.length&&<div className="feature-empty">No credentials saved yet.</div>}
      </div>
      <div className="feature-editor">
        {selected?<div className="snippet-form">
          <label>Label<input value={selected.Name} maxLength={128}
            placeholder="e.g. Network Administrator"
            onChange={e=>update({Name:e.target.value})}/></label>
          <label>Username<input value={selected.User} maxLength={128}
            autoComplete="username" placeholder="root"
            onChange={e=>update({User:e.target.value})}/></label>
          <label>New password
            <input type="password" autoComplete="new-password" value={password}
              placeholder={selected.HasStoredPassword?'Stored securely — leave blank to keep':'Enter optional password'}
              disabled={clearPassword} onChange={e=>{setPassword(e.target.value);setSaved(false);}}/>
          </label>
          <label className="check-row"><input type="checkbox" checked={clearPassword}
            onChange={e=>{setClearPassword(e.target.checked);setPassword('');}}/>
            Remove existing saved password
          </label>
          <label>Vaultwarden item (retrieved by ShiroTerm Server)
            <select aria-label="Vaultwarden item" value={selected.VaultItemId||''}
              onChange={e=>update({VaultItemId:e.target.value})}>
              <option value="">No linked vault item</option>
              {selected.VaultItemId&&!vaultItems.some(v=>v.id===selected.VaultItemId)&&
                <option value={selected.VaultItemId}>Previously linked: {selected.VaultItemId}</option>}
              {vaultItems.map(item=><option key={item.id} value={item.id}>
                {item.name}{item.username?' · '+item.username:''}</option>)}
            </select>
          </label>
          {vaultState?.connected&&<div className="credential-info" style={{display:'block'}}>
            <strong>Save password to Vaultwarden through ShiroTerm Server</strong>
            <label style={{display:'block',marginTop:10}}>Password for Vaultwarden
              <input aria-label="Vaultwarden password to write" type="password"
                autoComplete="new-password" value={vaultWritePassword}
                onChange={e=>{setVaultWritePassword(e.target.value);setSaved(false);}}
                placeholder="Separate from the locally saved password"/>
            </label>
            <button className="secondary-button" style={{marginTop:8}}
              disabled={vaultBusy||busy||!vaultWritePassword}
              onClick={()=>void writeToVault()}>
              <ShieldCheck size={16}/>
              {selected.VaultItemId?'Update linked Vaultwarden login':'Create Vaultwarden login'}
            </button>
            <p style={{fontSize:12,marginTop:8}}>
              This requires confirmation. Existing login updates are rejected if the vault item
              changed since it was loaded. The password is not saved on this PC.
            </p>
            {vaultError&&<div className="inline-error" role="alert">{vaultError}</div>}
          </div>}
          <label>Notes<textarea rows={3} value={selected.Notes}
            onChange={e=>update({Notes:e.target.value})}/></label>
          <div className="credential-info">
            <ShieldCheck size={18}/>
            {selected.HasStoredPassword?'An encrypted password is stored. It cannot be displayed.':
              'Passwords are never stored in plaintext or imported from WinForms.'}
          </div>
          {saved&&<div className="save-success"><Check size={16}/> Credential saved</div>}
          {error&&<div className="inline-error">{error}</div>}
          <div className="snippet-actions">
            <button className="secondary-button danger-action" disabled={busy}
              onClick={remove}><Trash2 size={16}/> Remove</button>
            <button className="primary-button" disabled={busy}
              onClick={submit}><Save size={16}/> Save credential</button>
          </div>
        </div>:<div className="feature-empty large">
          <UserRound size={25}/> Select a credential or create one.
        </div>}
      </div>
    </div>
  </div>;
}
