import {useCallback,useEffect,useMemo,useState} from 'react';
import {Activity,AlertCircle,CheckCircle,ClipboardCopy,RefreshCcw,Trash2} from 'lucide-react';
import type {ActivityRecord,SshEvent} from '../types';

const formatTime=(iso:string)=>new Date(iso).toLocaleTimeString();
const display=(record:ActivityRecord)=>{
  if(record.type==='error')return record.message||'Connection error';
  if(record.type==='verify')return record.changed?
    'Server key changed — verification requested':'New server key — verification requested';
  return record.status.replaceAll('-',' ')||'Connection event';
};
export default function Logs(){
  const [rows,setRows]=useState<ActivityRecord[]>([]);
  const [type,setType]=useState('all');
  const [search,setSearch]=useState('');
  const [error,setError]=useState('');
  const refresh=useCallback(async()=>{
    try{setRows(await window.shiro.listActivity());setError('');}
    catch(e){setError(String(e));}
  },[]);
  useEffect(()=>{
    void refresh();
    const stop=window.shiro.onSshEvent((event:SshEvent)=>{
      if(event.type!=='data')void refresh();
    });
    return stop;
  },[refresh]);
  const filtered=useMemo(()=>rows.filter(row=>{
    if(type!=='all'&&row.type!==type)return false;
    const q=search.trim().toLowerCase();
    return !q||[row.host,row.sessionId,row.status,row.message].some(
      item=>item.toLowerCase().includes(q));
  }).reverse(),[rows,type,search]);
  const clear=async()=>{
    if(!confirm('Clear the in-memory connection activity log?'))return;
    try{await window.shiro.clearActivity();await refresh();}
    catch(e){setError(String(e));}
  };
  const copy=async()=>{
    const message=filtered.map(row=>
      [row.time,row.type,row.host,display(row)].join(' | ')).join('\n');
    try{await window.shiro.copyText(message.slice(0,16384));}
    catch(e){setError(String(e));}
  };
  return <div className="feature-screen">
    <header className="feature-header"><div><h2>Connection activity</h2>
      <p>Session status, errors and SSH identity prompts. Terminal content is never logged.</p>
    </div><div className="activity-actions">
      <button className="secondary-button" onClick={refresh}><RefreshCcw size={15}/> Refresh</button>
      <button className="secondary-button" disabled={!filtered.length} onClick={copy}>
        <ClipboardCopy size={15}/> Copy</button>
      <button className="secondary-button" disabled={!rows.length} onClick={clear}>
        <Trash2 size={15}/> Clear</button>
    </div></header>
    <div className="activity-filters">
      <input aria-label="Search activity" placeholder="Filter by host, event or session…"
        value={search} onChange={e=>setSearch(e.target.value)}/>
      <select aria-label="Event type" value={type} onChange={e=>setType(e.target.value)}>
        <option value="all">All events</option><option value="status">Connections</option>
        <option value="verify">Identity checks</option><option value="error">Errors</option>
      </select>
      <span>{filtered.length} events</span>
    </div>
    {error&&<div className="inline-error">{error}</div>}
    <div className="activity-scroll">
      {!filtered.length?<div className="feature-empty large"><Activity size={25}/>
        No matching connection events in this application session.</div>
      :filtered.map(row=><div key={row.id} className="activity-row">
        {row.type==='error'?<AlertCircle size={18} className="activity-error"/>:
          row.type==='verify'?<Activity size={18} className="activity-verify"/>:
            <CheckCircle size={18} className="activity-status"/>}
        <div className="activity-main">
          <strong>{row.host||'SSH session'}</strong>
          <span>{display(row)}</span>
        </div>
        <time dateTime={row.time}>{formatTime(row.time)}</time>
      </div>)}
    </div>
    <footer className="activity-footer">Only the last 500 connection events are kept in memory.
      Activity is not written to disk.</footer>
  </div>;
}
