import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent,type MouseEvent} from 'react';
import {Folder,FolderPlus,FileText,ArrowUp,RefreshCw,Download,Upload,
  HardDrive,Pencil,Trash2,X,AlertTriangle,Monitor,Server,
  Search,ChevronLeft,ChevronRight,MoreHorizontal,Check,EyeOff,Eye,
  ArrowLeftRight,ListFilter} from 'lucide-react';
import type {RemoteFile,CommanderProgress} from '../types';
import {localJoin,parentLocal} from '../local-paths';
type Side='local'|'remote';
type Operation='mkdir'|'rename'|'delete';
type Dialog={side:Side;operation:Operation;original:string;value:string}|null;
type Context={side:Side;x:number;y:number;name:string}|null;
const readable=(v:number)=>v>=1073741824?(v/1073741824).toFixed(1)+' GB':
  v>=1048576?(v/1048576).toFixed(1)+' MB':v>=1024?(v/1024).toFixed(1)+' KB':v+' B';
const explain=(e:unknown)=>e instanceof Error?e.message:String(e);
const remoteJoin=(p:string,n:string)=>p.replace(/\/$/,'')+'/'+n;
const parentRemote=(p:string)=>p==='/'?'/':p.replace(/\/[^/]+\/?$/,'')||'/';
export default function Sftp({sessionId}:{sessionId:string}){
  const [dirs,setDirs]=useState<Record<Side,string>>({local:'',remote:'/'});
  const [pathInputs,setPathInputs]=useState<Record<Side,string>>({local:'',remote:'/'});
  const [entries,setEntries]=useState<Record<Side,RemoteFile[]>>({local:[],remote:[]});
  const [chosen,setChosen]=useState<Record<Side,string[]>>({local:[],remote:[]});
  const [filters,setFilters]=useState<Record<Side,string>>({local:'',remote:''});
  const [hidden,setHidden]=useState<Record<Side,boolean>>({local:false,remote:false});
  const [sort,setSort]=useState<'name'|'mtime'|'size'|'kind'>('name');
  const [reverse,setReverse]=useState(false);
  const [context,setContext]=useState<Context>(null);
  const [active,setActive]=useState<Side>('local');
  const [dialog,setDialog]=useState<Dialog>(null);
  const [busy,setBusy]=useState(false);
  // SFTP readiness is not the same as SSH transport readiness.
  const [connected,setConnected]=useState(false);
  const [error,setError]=useState('');
  const [note,setNote]=useState('');
  const [progress,setProgress]=useState<CommanderProgress|null>(null);
  const [activity,setActivity]=useState<{name:string;direction:string;status:string}[]>([]);
  const [dragTarget,setDragTarget]=useState<Side|null>(null);
  const anchor=useRef<Record<Side,string>>({local:'',remote:''});
  const request=useRef<Record<Side,number>>({local:0,remote:0});
  const files=useMemo(()=>({
    local:entries.local.filter(e=>(hidden.local||!e.name.startsWith('.'))&&
      e.name.toLowerCase().includes(filters.local.toLowerCase())),
    remote:entries.remote.filter(e=>(hidden.remote||!e.name.startsWith('.'))&&
      e.name.toLowerCase().includes(filters.remote.toLowerCase()))
  }),[entries,hidden,filters]);
  const order=(data:RemoteFile[])=>[...data].sort((a,b)=>{
    if(a.directory!==b.directory)return a.directory?-1:1;
    const diff=sort==='size'?a.size-b.size:sort==='mtime'?a.mtime-b.mtime:
      sort==='kind'?String(a.directory).localeCompare(String(b.directory)):
      a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'});
    return reverse?-diff:diff;
  });
  const refresh=useCallback(async(side:Side)=>{
    const folder=dirs[side];if(!folder)return;
    const id=++request.current[side];
    try{
      const next=side==='local'?await window.shiro.commanderLocalList(folder):
        {folder,entries:await window.shiro.listFiles(sessionId,folder)};
      if(id!==request.current[side])return;
      setEntries(old=>({...old,[side]:next.entries}));
      setPathInputs(old=>({...old,[side]:next.folder}));
      setChosen(old=>({...old,[side]:old[side].filter(n=>next.entries.some(x=>x.name===n))}));
      if(side==='remote'){
        setConnected(true);
        setError(old=>/SFTP channel|SFTP subsystem|SSH session/i.test(old)?'':old);
      }
    }catch(e){
      if(id!==request.current[side])return;
      setEntries(old=>({...old,[side]:[]}));
      const description=explain(e);
      if(side==='remote'&&/SFTP subsystem|SSH session|channel closed|Connection lost/i.test(description))
        setConnected(false);
      setError(description);
    }
  },[dirs,sessionId]);
  useEffect(()=>{let valid=true;void window.shiro.commanderHome().then(p=>{
    if(valid){setDirs(d=>({...d,local:p}));setPathInputs(d=>({...d,local:p}));}
  }).catch(e=>{if(valid)setError(explain(e));});return()=>{valid=false;};},[]);
  useEffect(()=>{void refresh('local');return()=>{request.current.local++;};},[refresh,dirs.local]);
  useEffect(()=>{void refresh('remote');return()=>{request.current.remote++;};},[refresh,dirs.remote]);
  useEffect(()=>window.shiro.onCommanderProgress(value=>{
    if(value.sessionId===sessionId)setProgress(value);
  }),[sessionId]);
  useEffect(()=>window.shiro.onSshEvent(event=>{
    if(event.sessionId!==sessionId||event.type!=='status')return;
    if(['shell-ready','sftp-ready'].includes(event.status||'')){
      void refresh('remote');
    }else if(event.status==='sftp-closed'){
      request.current.remote++;
      setConnected(false);setEntries(d=>({...d,remote:[]}));
      setChosen(d=>({...d,remote:[]}));
      setError('SFTP channel closed. Click Refresh to reopen the connection.');
    }else if(['closed','reconnect-exhausted','reconnect-stopped','reconnect-wait']
      .includes(event.status||'')){
      request.current.remote++;
      setConnected(false);setEntries(d=>({...d,remote:[]}));
      setChosen(d=>({...d,remote:[]}));setContext(null);
      setError('SFTP session disconnected. Reconnect the SSH host.');
    }
  }),[sessionId,refresh]);
  useEffect(()=>{
    if(!context)return;
    const close=()=>setContext(null);
    window.addEventListener('click',close);
    window.addEventListener('keydown',close);
    return()=>{window.removeEventListener('click',close);window.removeEventListener('keydown',close);};
  },[context]);
  const go=(side:Side,next:string)=>{
    if(busy)return;
    setActive(side);setContext(null);setError('');
    setDirs(d=>({...d,[side]:next}));
    setPathInputs(d=>({...d,[side]:next}));
    setChosen(d=>({...d,[side]:[]}));
  };
  const select=(side:Side,name:string,e:MouseEvent)=>{
    setActive(side);
    const visible=files[side].map(x=>x.name);
    const current=chosen[side];
    let next:string[];
    if(e.shiftKey&&anchor.current[side]){
      const start=visible.indexOf(anchor.current[side]),end=visible.indexOf(name);
      next=start<0?[name]:[...new Set([...current,...visible.slice(Math.min(start,end),Math.max(start,end)+1)])];
    }else if(e.ctrlKey||e.metaKey)next=current.includes(name)?
      current.filter(n=>n!==name):[...current,name];
    else next=[name];
    if(!e.shiftKey)anchor.current[side]=name;
    setChosen(old=>({...old,[side]:next}));
  };
  const selectAll=(side:Side)=>{
    setChosen(old=>({...old,[side]:files[side].map(x=>x.name)}));
    setContext(null);
  };
  const openFile=async(side:Side,name:string)=>{
    if(busy||side==='remote'&&!connected)return;
    setError('');setNote('');
    try{
      const result=await window.shiro.commanderOpen({sessionId,side,
        localFolder:dirs.local,remoteDir:dirs.remote,name});
      if(result.temporary)setNote('Remote file opened in your default editor. Saving changes will prompt to upload.');
      else setNote('File opened in your default application.');
    }catch(e){setError(explain(e));}
  };
  const makeDialog=(side:Side,operation:Operation,name='')=>{
    setDialog({side,operation,original:name,value:operation==='mkdir'?'':name});
    setContext(null);setError('');
  };
  const transfer=async(direction:'upload'|'download',requested?:string[])=>{
    const source:Side=direction==='upload'?'local':'remote';
    const target:Side=source==='local'?'remote':'local';
    const selection=requested?.length?requested:chosen[source];
    if(!selection.length||busy||!connected)return;
    const rootCollisions=selection.filter(name=>entries[target].some(x=>x.name===name));
    const overwrite=rootCollisions.length>0;
    if(overwrite&&!confirm('Replace or merge '+rootCollisions.length+
      ' existing destination item(s)? Existing files may be overwritten.'))return;
    setBusy(true);setError('');setNote('');setProgress(null);setContext(null);
    const label=selection.length===1?selection[0]:selection.length+' items';
    const perform=(replace:boolean)=>window.shiro.commanderTransferBatch({
      sessionId,direction,localFolder:dirs.local,remoteDir:dirs.remote,
      names:selection,overwrite:replace});
    try{
      let result;
      try{result=await perform(overwrite);}
      catch(e){
        if(!overwrite&&/confirm overwrite|already exists/i.test(explain(e))&&
          confirm('A destination file already exists in a subfolder. Replace existing files?'))
          result=await perform(true);
        else throw e;
      }
      setNote((direction==='upload'?'Uploaded ':'Downloaded ')+result.files+
        ' file(s) in '+result.folders+' folder(s).');
      setActivity(old=>[{name:label,direction,
        status:result.files+' files · '+readable(result.total)},...old].slice(0,7));
      await Promise.all([refresh('local'),refresh('remote')]);
    }catch(e){setError(explain(e));setActivity(old=>[{name:label,direction,status:'FAILED'},...old].slice(0,7));}
    finally{setBusy(false);setProgress(null);setDragTarget(null);}
  };
  const externalDrop=async(files:File[])=>{
    if(busy||!connected||!files.length)return;
    let paths:string[];
    try{
      paths=files.map(file=>window.shiro.commanderFilePath(file)).filter(Boolean);
      if(!paths.length)throw Error('The file manager did not provide a usable file path');
    }catch(e){setError(explain(e));return;}
    setBusy(true);setError('');setNote('');setProgress(null);
    const perform=(overwrite:boolean)=>window.shiro.commanderExternalDrop({
      sessionId,remoteDir:dirs.remote,paths,overwrite});
    try{
      let result;
      try{result=await perform(false);}
      catch(e){
        if(/confirm overwrite|already exists/i.test(explain(e))&&
           confirm('Files already exist on the remote server. Overwrite them?'))
          result=await perform(true);
        else throw e;
      }
      setNote('Uploaded '+result.files+' file(s) and '+result.folders+' folder(s) from the file manager.');
      setActivity(old=>[{name:paths.length+' Explorer items',direction:'upload',
        status:result.files+' files · '+readable(result.total)},...old].slice(0,7));
      await refresh('remote');
    }catch(e){setError(explain(e));}
    finally{setBusy(false);setProgress(null);setDragTarget(null);}
  };
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(!dialog||busy)return;
    const {side,operation,original,value}=dialog;
    const name=operation==='mkdir'?value.trim():original;
    const newName=operation==='rename'?value.trim():undefined;
    if(!name||['.','..'].includes(name)||/[\\/\x00-\x1f\x7f]/.test(name)||
       (operation==='rename'&&(!newName||/[\\/\x00-\x1f\x7f]/.test(newName)))){
      setError('Invalid file or directory name');return;
    }
    setBusy(true);setError('');
    try{
      if(side==='local')await window.shiro.commanderLocalAction({
        operation,folder:dirs.local,name,newName});
      else await window.shiro.sftpAction(sessionId,{
        operation,folder:dirs.remote,name,newName});
      setChosen(c=>({...c,[side]:[]}));setDialog(null);setNote('Operation completed');
      await refresh(side);
    }catch(e){setError(explain(e));}finally{setBusy(false);}
  };
  const menu=(side:Side,name:string,x:number,y:number)=>{
    setActive(side);
    if(name&&!chosen[side].includes(name))setChosen(c=>({...c,[side]:[name]}));
    setContext({side,name,x:Math.min(x,window.innerWidth-250),
      y:Math.min(y,window.innerHeight-320)});
  };
  const panes=([
    {side:'local' as Side,title:'THIS COMPUTER',icon:Monitor,path:dirs.local},
    {side:'remote' as Side,title:'REMOTE SFTP',icon:Server,path:dirs.remote}
  ]);
  return <section className="commander-screen commander-v2">
    <div className="commander-header">
      <div><h3><ArrowLeftRight size={18}/> SFTP Commander</h3></div>
      <div className="commander-actions">
        <span className={'commander-connect '+(connected?'online':'offline')}>
          {connected?'● SFTP connected':'● SFTP unavailable'}</span>
        <button className="secondary-button" disabled={busy}
          onClick={()=>{void refresh('local');void refresh('remote');}}>
          <RefreshCw size={15}/> Refresh</button>
      </div>
    </div>
    <div className="commander-workspace">
      {panes.map(pane=>{
        const side=pane.side,visible=order(files[side]);
        const selected=chosen[side];
        const Icon=pane.icon;
        return <div key={side} className={'commander-pane '+(active===side?'active ':'')+
          (dragTarget===side?'drop-target':'')}
          onDragOver={e=>{
            if(e.dataTransfer.types.includes('application/x-shiro-commander')||
               (side==='remote'&&e.dataTransfer.types.includes('Files'))){
              e.preventDefault();setDragTarget(side);
            }
          }}
          onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragTarget(null);}}
          onDrop={e=>{
            e.preventDefault();setDragTarget(null);
            const raw=e.dataTransfer.getData('application/x-shiro-commander');
            if(raw){
              try{
                const item=JSON.parse(raw) as {source:Side;names:string[]};
                if(item.source!==side)void transfer(item.source==='local'?'upload':'download',item.names);
              }catch{setError('Invalid internal file transfer.');}
            }else if(side==='remote'&&e.dataTransfer.files.length)
              void externalDrop(Array.from(e.dataTransfer.files));
          }}>
          <div className="commander-pane-heading">
            <Icon size={17}/>
            <strong>{pane.title}</strong>
            <span>{visible.length} items</span>
            <div className="commander-top-tools">
              <button type="button" title="Filter files" className="icon-button"
                onClick={()=>document.getElementById('filter-'+side)?.focus()}><Search size={15}/></button>
              <button type="button" title="Actions" className="icon-button"
                onClick={e=>{const r=e.currentTarget.getBoundingClientRect();
                  menu(side,'',r.left-185,r.bottom+6);}}><MoreHorizontal size={18}/></button>
            </div>
          </div>
          <div className="commander-pathbar">
            <button className="icon-button" title="Parent directory" disabled={busy||(side==='remote'&&!connected)}
              onClick={()=>go(side,side==='local'?parentLocal(pane.path):parentRemote(pane.path))}>
              <ChevronLeft size={17}/></button>
            <button className="icon-button" title="Refresh this folder"
              onClick={()=>void refresh(side)} disabled={busy}><RefreshCw size={15}/></button>
            <input aria-label={side+' directory path'} value={pathInputs[side]}
              onChange={e=>setPathInputs(p=>({...p,[side]:e.target.value}))}
              onKeyDown={e=>{if(e.key==='Enter')go(side,pathInputs[side]);}}
              disabled={busy||(side==='remote'&&!connected)}/>
            <button className="icon-button" title="Go to path" disabled={busy}
              onClick={()=>go(side,pathInputs[side])}><ChevronRight size={16}/></button>
          </div>
          <div className="commander-filter"><Search size={14}/>
            <input id={'filter-'+side} aria-label={'Filter '+side} value={filters[side]}
              placeholder="Filter files…" onChange={e=>setFilters(old=>({...old,[side]:e.target.value}))}/>
            <button type="button" className="icon-button" title="Toggle hidden files"
              onClick={()=>setHidden(old=>({...old,[side]:!old[side]}))}>
              {hidden[side]?<Eye size={15}/>:<EyeOff size={15}/>}</button>
          </div>
          <div className="commander-file-heading">
            <button onClick={()=>{setSort('name');setReverse(sort==='name'?!reverse:false);}}>Name</button>
            <button onClick={()=>{setSort('mtime');setReverse(sort==='mtime'?!reverse:false);}}>Date Modified</button>
            <button onClick={()=>{setSort('size');setReverse(sort==='size'?!reverse:false);}}>Size</button>
            <button onClick={()=>{setSort('kind');setReverse(sort==='kind'?!reverse:false);}}>Kind</button>
          </div>
          <div className="commander-file-list" role="listbox" tabIndex={0}
            aria-multiselectable="true" aria-label={side==='local'?'Local files':'Remote SFTP files'}
            onClick={()=>{setActive(side);setContext(null);}}
            onKeyDown={e=>{
              if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){
                e.preventDefault();selectAll(side);
              }
              if(e.key==='Backspace'){e.preventDefault();go(side,side==='local'?
                parentLocal(pane.path):parentRemote(pane.path));}
              if(e.key==='Delete'&&selected.length===1)makeDialog(side,'delete',selected[0]);
            }}>
            <button className="commander-file commander-parent" onDoubleClick={()=>
              go(side,side==='local'?parentLocal(pane.path):parentRemote(pane.path))}
              onClick={()=>setActive(side)} title="Parent folder">
              <span><Folder size={17}/> ..</span><small>—</small><small>—</small><small>Folder</small>
            </button>
            {visible.map(item=><button type="button" key={item.name}
              role="option" aria-selected={selected.includes(item.name)}
              draggable={!busy}
              onDragStart={e=>{
                const names=selected.includes(item.name)?selected:[item.name];
                e.dataTransfer.setData('application/x-shiro-commander',
                  JSON.stringify({source:side,names}));
                e.dataTransfer.effectAllowed='copy';
              }}
              className={'commander-file '+(selected.includes(item.name)?'selected':'')}
              onClick={e=>select(side,item.name,e)}
              onContextMenu={e=>{e.preventDefault();e.stopPropagation();
                menu(side,item.name,e.clientX,e.clientY);}}
              onDoubleClick={()=>{if(item.directory)go(side,side==='local'?
                localJoin(pane.path,item.name):remoteJoin(pane.path,item.name));
                else void openFile(side,item.name);}}>
              <span>{item.directory?<Folder size={17}/>:<FileText size={17}/>}
                <span title={item.name}>{item.name}</span></span>
              <small>{item.mtime?new Date(item.mtime*1000).toLocaleDateString():''}</small>
              <small>{item.directory?'—':readable(item.size)}</small>
              <small>{item.directory?'Folder':'File'}</small>
            </button>)}
            {!visible.length&&<div className="hint-row">
              {side==='local'&&!dirs.local?'Opening local directory…':
                side==='remote'&&!connected?'SFTP connection unavailable':'No matching items'}
            </div>}
          </div>
          <div className="commander-pane-footer"><span>{side==='local'?'Local':'Remote'} · {selected.length} selected</span>
            <button className="icon-button" title="Select all" onClick={()=>selectAll(side)}>
              <Check size={15}/></button></div>
        </div>;
      })}
    </div>
    <div className="commander-transfer-bar">
      <button className="primary-button" disabled={busy||!connected||!chosen.local.length}
        onClick={()=>void transfer('upload')}><Upload size={17}/> Copy to remote <span>→</span></button>
      <button className="secondary-button" disabled={busy||!connected||!chosen.remote.length}
        onClick={()=>void transfer('download')}><Download size={17}/> Copy to local <span>←</span></button>
      <button className="secondary-button" disabled={busy}
        onClick={()=>makeDialog(active,'mkdir')}><FolderPlus size={16}/> New folder</button>
    </div>
    {(progress||activity.length>0)&&<div className="commander-queue">
      <div className="commander-queue-title"><ListFilter size={15}/> Transfers <span>{busy?'IN PROGRESS':'RECENT'}</span></div>
      {progress&&<div className="commander-progress" role="status">
        <div><span>{progress.name}</span><strong>{progress.percent}%</strong></div>
        <progress max={100} value={progress.percent}/><small>{readable(progress.bytes)} / {readable(progress.total)}</small>
      </div>}
      {activity.map((item,index)=><div className="commander-queue-row" key={index}>
        <span>{item.direction==='upload'?'↑':'↓'} {item.name}</span><small>{item.status}</small></div>)}
    </div>}
    {error&&<div className="inline-error sftp-feedback" role="alert">{error}</div>}
    {note&&<div className="sftp-success" role="status">{note}</div>}
    {context&&<div className="commander-context-menu" role="menu"
      style={{left:Math.max(8,context.x),top:Math.max(8,context.y)}}
      onClick={e=>e.stopPropagation()}>
      {context.name&&<button onClick={()=>{
        const item=entries[context.side].find(e=>e.name===context.name);
        if(item?.directory)go(context.side,context.side==='local'?
          localJoin(dirs.local,item.name):remoteJoin(dirs.remote,item.name));
        else if(item)void openFile(context.side,item.name);
        setContext(null);
      }}>Open</button>}
      {context.name&&<button onClick={()=>void transfer(context.side==='local'?'upload':'download',
        chosen[context.side].includes(context.name)?chosen[context.side]:[context.name])}>
        Copy to target directory <ArrowLeftRight size={14}/></button>}
      {context.name&&<button onClick={()=>makeDialog(context.side,'rename',context.name)}>Rename</button>}
      {context.name&&<button className="danger" onClick={()=>makeDialog(context.side,'delete',context.name)}>Delete</button>}
      <hr/>
      <button onClick={()=>{void refresh(context.side);setContext(null);}}>Refresh</button>
      <button onClick={()=>makeDialog(context.side,'mkdir')}>New folder</button>
      <button onClick={()=>{setHidden(old=>({...old,[context.side]:!old[context.side]}));setContext(null);}}>
        {hidden[context.side]?'Hide':'Show'} hidden files</button>
      <button onClick={()=>selectAll(context.side)}>Select all</button>
      <button onClick={()=>setContext(null)}>Close</button>
    </div>}
    {dialog&&<div className="sftp-dialog-backdrop" onClick={()=>setDialog(null)}>
      <form className="sftp-dialog" aria-label="SFTP file action" onClick={e=>e.stopPropagation()} onSubmit={e=>void submit(e)}>
        <div className="sftp-dialog-heading">
          <div className="sftp-dialog-title">
            {dialog.operation==='delete'?<AlertTriangle size={18}/>:<FolderPlus size={18}/>}
            <strong>{dialog.operation==='mkdir'?'Create folder':dialog.operation==='rename'?'Rename item':'Delete item'}</strong>
          </div><button type="button" className="icon-button" onClick={()=>setDialog(null)}><X size={16}/></button>
        </div>
        {dialog.operation==='delete'?<p className="sftp-dialog-description">
          Delete {dialog.original} from {dirs[dialog.side]}? This cannot be undone.
          Directories must be empty.</p>:<label className="field">
          {dialog.operation==='mkdir'?'Folder name':'New name'}
          <input value={dialog.value} autoFocus maxLength={255} disabled={busy}
            onChange={e=>setDialog(d=>d?{...d,value:e.target.value}:null)}/></label>}
        {error&&<div className="inline-error">{error}</div>}
        <div className="sftp-dialog-actions">
          <button type="button" className="secondary-button" onClick={()=>setDialog(null)}>Cancel</button>
          <button type="submit" className="primary-button" disabled={busy}>Confirm</button>
        </div>
      </form>
    </div>}
  </section>;
}
