import {useCallback,useEffect,useState} from 'react';
import {ArrowLeftRight,Plus,RefreshCw,ShieldCheck,Square,Unplug} from 'lucide-react';
import type {LocalForwardRule,Session} from '../types';

export default function Forwarding({sessions}:{sessions:Session[]}){
  const [rules,setRules]=useState<LocalForwardRule[]>([]);
  const [sessionId,setSessionId]=useState('');
  const [listenPort,setListenPort]=useState(8080);
  const [targetHost,setTargetHost]=useState('127.0.0.1');
  const [targetPort,setTargetPort]=useState(80);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const live=sessions.filter(s=>s.protocol==='SSH'&&
    (s.status==='connected'||s.status==='shell-ready'));
  const refresh=useCallback(async()=>{
    try{setRules(await window.shiro.listForwards());}
    catch(e){setError(String(e));}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    if(!live.some(s=>s.id===sessionId))setSessionId(live[0]?.id||'');
  },[live.map(s=>s.id).join(','),sessionId]);
  const start=async()=>{
    setError('');setBusy(true);
    try{
      await window.shiro.startForward({sessionId,listenPort,targetHost,targetPort});
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const stop=async(id:string)=>{
    setError('');setBusy(true);
    try{await window.shiro.stopForward(id);await refresh();}
    catch(e){setError(String(e));}
    finally{setBusy(false);}
  };
  return <div className="feature-screen">
    <header className="feature-header"><div><h2>Port Forwarding</h2></div>
      <button className="secondary-button" onClick={refresh}><RefreshCw size={16}/> Refresh</button>
    </header>
    <div className="feature-editor">
      <div className="feature-forward">
        <section className="editor-card expanded">
          <div className="static-card-title"><ArrowLeftRight size={18}/> New local forwarding</div>
          <div className="forward-fields">
            <label>Active SSH session
              <select value={sessionId} onChange={e=>setSessionId(e.target.value)}>
                {!live.length&&<option value="">Connect to a host first</option>}
                {live.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Local port<input type="number" min="1" max="65535" value={listenPort}
              onChange={e=>setListenPort(Number(e.target.value))}/></label>
            <label>Remote destination<input value={targetHost}
              onChange={e=>setTargetHost(e.target.value)} placeholder="127.0.0.1"/></label>
            <label>Destination port<input type="number" min="1" max="65535"
              value={targetPort} onChange={e=>setTargetPort(Number(e.target.value))}/></label>
          </div>
          <div className="forward-note"><ShieldCheck size={16}/>
            Local listeners bind only to 127.0.0.1, never to the public network.</div>
          <button className="primary-button" disabled={busy||!sessionId}
            onClick={start}><Plus size={17}/> Start forwarding</button>
        </section>
        <h3>Active forwardings <span className="count">{rules.length}</span></h3>
        {error&&<div className="inline-error">{error}</div>}
        {rules.length?rules.map(rule=><div className="forward-rule" key={rule.id}>
          <ArrowLeftRight size={19}/>
          <div><strong>127.0.0.1:{rule.listenPort}</strong><span>
            via {sessions.find(s=>s.id===rule.sessionId)?.name||'SSH session'}
            {' → '}{rule.targetHost}:{rule.targetPort}</span></div>
          <button className="secondary-button" disabled={busy} onClick={()=>stop(rule.id)}>
            <Square size={14}/> Stop</button>
        </div>):<div className="feature-empty"><Unplug size={20}/> No local forwards are active.</div>}
      </div>
    </div>
  </div>;
}
