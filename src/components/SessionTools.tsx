import {useEffect,useRef,useState} from 'react';
import {Code2,Palette,PanelRightClose,Search,Send,TerminalSquare} from 'lucide-react';
import type {Snippet} from '../types';
import type {TerminalThemeId} from '../terminal-themes';
import ThemePicker from './ThemePicker';

export default function SessionTools({open,tab,onTabChange,themeId,defaultId,home,snippets,
  onSelect,onMakeDefault,onSnippet,onClose}:{
  open:boolean;tab:'appearance'|'snippets';onTabChange:(tab:'appearance'|'snippets')=>void;
  themeId:TerminalThemeId;defaultId:TerminalThemeId;home:boolean;snippets:Snippet[];
  onSelect:(id:TerminalThemeId)=>void;onMakeDefault:()=>void;
  onSnippet:(snippet:Snippet,run:boolean)=>Promise<void>;onClose:()=>void;
}){
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{
      if(event.target instanceof Element&&event.target.closest('.session-drawer-trigger'))return;
      if(event.target instanceof Node&&!root.current?.contains(event.target))onClose();
    };
    const esc=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
    window.addEventListener('pointerdown',outside,true);
    window.addEventListener('keydown',esc,true);
    return ()=>{
      window.removeEventListener('pointerdown',outside,true);
      window.removeEventListener('keydown',esc,true);
    };
  },[onClose,open]);
  const submit=async(snippet:Snippet,run:boolean)=>{
    setError('');
    try{await onSnippet(snippet,run);onClose();}
    catch(e){setError(e instanceof Error?e.message:String(e));}
  };
  const matches=snippets.filter(s=>(s.Name+' '+s.Command).toLowerCase().includes(query.toLowerCase()));
  return <aside id="shiro-session-drawer" ref={root}
    className={'session-tools '+(open?'is-open':'')}
    aria-label="Session tools" aria-hidden={!open} inert={!open}>
    <header className="session-tools-header">
      <div><strong>{home?'Workspace tools':'Session tools'}</strong><span>{home?'Workspace appearance':'Appearance and quick commands'}</span></div>
      <button className="icon-button" title="Close side panel" aria-label="Close side panel" onClick={onClose}>
        <PanelRightClose size={17}/></button>
    </header>
    <div className="session-tools-tabs" role="tablist">
      <button role="tab" aria-selected={tab==='appearance'} className={tab==='appearance'?'active':''}
        onClick={()=>onTabChange('appearance')}><Palette size={15}/> Themes</button>
      <button role="tab" aria-selected={tab==='snippets'} className={tab==='snippets'?'active':''}
        onClick={()=>onTabChange('snippets')}><Code2 size={15}/> Snippets</button>
    </div>
    {tab==='appearance'?<div className="session-tools-body">
      <ThemePicker embedded themeId={themeId} defaultId={defaultId}
        onSelect={onSelect} onMakeDefault={onMakeDefault} onClose={onClose}/>
    </div>:<div className="session-tools-body">
      <div className="session-snippet-search"><Search size={15}/>
        <input aria-label="Find snippet" placeholder="Find a saved command…" value={query}
          onChange={e=>setQuery(e.target.value)}/></div>
      {error&&<div className="inline-error">{error}</div>}
      <div className="session-snippets">
        {matches.map(s=><div className="session-snippet" key={s.Id}>
          <div className="session-snippet-content"><strong>{s.Name}</strong><code title={s.Command}>{s.Command}</code></div>
          {!home&&<div className="session-snippet-actions">
            <button onClick={()=>void submit(s,false)} title="Insert without pressing Enter">
              <TerminalSquare size={14}/> Insert</button>
            <button onClick={()=>void submit(s,true)} title="Run command (send Enter)">
              <Send size={14}/> Run</button>
          </div>}
        </div>)}
        {!matches.length&&<p className="session-tools-hint">No matching snippets.</p>}
      </div>
    </div>}
  </aside>;
}
