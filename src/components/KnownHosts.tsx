import {useCallback,useEffect,useState} from 'react';
import {Fingerprint,RefreshCw,Trash2} from 'lucide-react';
import type {KnownHost} from '../types';
export default function KnownHosts(){
  const [records,setRecords]=useState<KnownHost[]>([]);
  const [error,setError]=useState('');
  const reload=useCallback(()=>{
    window.shiro.listKnownHosts().then(setRecords)
      .catch(e=>setError(String(e)));
  },[]);
  useEffect(reload,[reload]);
  const remove=async(id:string)=>{
    if(!confirm('Forget the trusted key for '+id+'? Next connection will require verification.'))return;
    try{await window.shiro.removeKnownHost(id);reload();}
    catch(e){setError(String(e));}
  };
  return <div className="feature-screen">
    <header className="feature-header"><div><h2>Known Hosts</h2>
      <p>Trusted SSH host fingerprints saved in ShiroTerm Next.</p></div>
      <button className="secondary-button" onClick={reload}><RefreshCw size={16}/> Refresh</button>
    </header>
    {error&&<div className="inline-error">{error}</div>}
    <div className="known-list">
      {records.map(record=><div key={record.id} className="known-item">
        <Fingerprint size={21}/><div><strong>{record.id}</strong><code>{record.hash}</code>
          <span>Verified {new Date(record.verifiedAt).toLocaleString()}</span></div>
        <button className="icon-button" onClick={()=>remove(record.id)} aria-label={'Forget '+record.id}>
          <Trash2 size={17}/></button>
      </div>)}
      {!records.length&&<div className="feature-empty large">No host fingerprints trusted yet.</div>}
    </div>
  </div>;
}
