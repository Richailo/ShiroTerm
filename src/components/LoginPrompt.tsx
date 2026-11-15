import {useState,type FormEvent} from 'react';
import {FolderOpen,KeyRound,LockKeyhole,Server,X} from 'lucide-react';
import type {Host} from '../types';

export interface LoginValues {
  username:string;password:string;remember:boolean;
  keyFile:string;keyPassphrase:string;jumpPassphrase:string;
}
export default function LoginPrompt({host,username,reason,gatewayKey,hasSavedPassword,onSubmit,onCancel}:{
  host:Host;username:string;reason?:string;gatewayKey:boolean;hasSavedPassword:boolean;
  onSubmit:(values:LoginValues)=>Promise<void>;onCancel:()=>void;
}){
  const [user,setUser]=useState(username);
  const [password,setPassword]=useState('');
  const [keyFile,setKeyFile]=useState(host.KeyFile||'');
  const [remember,setRemember]=useState(false);
  const [keyPassphrase,setKeyPassphrase]=useState('');
  const [jumpPassphrase,setJumpPassphrase]=useState('');
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');
  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    if(!user.trim()){setError('Enter your SSH username.');return;}
    if(!password&&!keyFile&&!hasSavedPassword){
      setError('Enter an SSH password or choose an existing private key.');return;
    }
    setWorking(true);setError('');
    try{
      await onSubmit({username:user.trim(),password,remember,keyFile,
        keyPassphrase,jumpPassphrase});
      setPassword('');setKeyPassphrase('');setJumpPassphrase('');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setWorking(false);}
  };
  return <div className="modal-overlay credential-overlay">
    <form className="trust-modal credential-modal" onSubmit={submit}
      aria-label="SSH authentication" autoComplete="off">
      <div className="credential-modal-heading">
        <span className="trust-icon"><LockKeyhole size={25}/></span>
        <button className="icon-button" type="button" disabled={working}
          onClick={onCancel} aria-label="Cancel authentication"><X size={18}/></button>
      </div>
      <h2>Connect to {host.Name||host.Host}</h2>
      <p className="credential-host"><Server size={14}/> {host.Host}:{host.Port}</p>
      <p>No working login method is available yet. Enter your account password
        or select an SSH private key already authorized on the server.</p>
      {reason&&<div className="inline-error" role="alert">{reason}</div>}
      {error&&<div className="inline-error" role="alert">{error}</div>}
      <label className="field">Username
        <input autoFocus={!username} value={user} autoComplete="username"
          onChange={e=>setUser(e.target.value)} placeholder="root"/>
      </label>
      <label className="field">Password
        <input type="password" autoFocus={!!username} value={password}
          autoComplete="new-password" onChange={e=>setPassword(e.target.value)}
          placeholder={hasSavedPassword?'Leave blank to use saved password':'SSH account password'}/>
      </label>
      <label className="check-row"><input type="checkbox" checked={remember}
        disabled={!password} onChange={e=>setRemember(e.target.checked)}/>
        Save password securely for this host</label>
      <div className="credential-key-picker">
        <div className="field"><span>SSH private key (alternative to a password)</span>
          <div className="credential-key-line">
            <input readOnly aria-label="Selected SSH private key" value={keyFile}
              placeholder="No private key selected" title={keyFile}/>
            <button type="button" className="secondary-button" disabled={working}
              onClick={async()=>{
                try{const next=await window.shiro.selectKey();if(next)setKeyFile(next);}
                catch(e){setError(e instanceof Error?e.message:String(e));}
              }}><FolderOpen size={15}/> Choose key</button>
          </div>
        </div>
      </div>
      {keyFile&&<label className="field">Private key passphrase (optional)
        <input type="password" value={keyPassphrase} autoComplete="off"
          onChange={e=>setKeyPassphrase(e.target.value)}/>
      </label>}
      {gatewayKey&&<label className="field">Gateway key passphrase (optional)
        <input type="password" value={jumpPassphrase} autoComplete="off"
          onChange={e=>setJumpPassphrase(e.target.value)}/>
      </label>}
      <p className="info-note">A new SSH key will not work until its public key is
        authorized on the remote server. Passwords are saved only with your
        consent; one-time passwords and key passphrases are not retained.</p>
      <div className="modal-actions">
        <button className="secondary-button" type="button" disabled={working} onClick={onCancel}>Cancel</button>
        <button className="primary-button" type="submit" disabled={working}>
          <KeyRound size={15}/> {working?'Connecting…':'Connect'}
        </button>
      </div>
    </form>
  </div>;
}
