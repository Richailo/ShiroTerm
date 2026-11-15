import {useState} from 'react';
import {Check,Clipboard,FileCode2,Plus,Save,Trash2} from 'lucide-react';
import type {Snippet} from '../types';
export default function Snippets({items,onChange}:{
  items:Snippet[];onChange:(items:Snippet[])=>void
}){
  const [current,setCurrent]=useState<Snippet|null>(null);
  const [error,setError]=useState('');
  const [copied,setCopied]=useState('');
  const select=(s:Snippet)=>{setCurrent({...s});setError('');};
  const add=()=>select({Id:crypto.randomUUID(),Name:'',Command:''});
  const save=async()=>{
    if(!current)return;
    setError('');
    try{
      const result=await window.shiro.saveSnippet(current);
      onChange([...items.filter(s=>s.Id!==result.Id),result]);
      setCurrent(result);
    }catch(e){setError(String(e));}
  };
  const remove=async()=>{
    if(!current||!confirm('Delete this snippet?'))return;
    try{await window.shiro.removeSnippet(current.Id);
      onChange(items.filter(x=>x.Id!==current.Id));setCurrent(null);}
    catch(e){setError(String(e));}
  };
  const copy=async(s:Snippet)=>{
    await window.shiro.copyText(s.Command);
    setCopied(s.Id);
  };
  return <div className="feature-screen">
    <header className="feature-header"><div><h2>Snippets</h2></div>
      <button className="primary-button" onClick={add}><Plus size={17}/> New snippet</button>
    </header>
    <div className="feature-columns">
      <div className="feature-list">
        {items.map(item=><button key={item.Id}
          className={'feature-item '+(current?.Id===item.Id?'active':'')}
          onClick={()=>select(item)}>
          <FileCode2 size={18}/><span>{item.Name||'Untitled'}</span>
          <span className="feature-item-action" title="Copy command"
            onClick={e=>{e.stopPropagation();copy(item);}}>
            {copied===item.Id?<Check size={16}/>:<Clipboard size={16}/>}</span>
        </button>)}
        {!items.length&&<p className="feature-empty">No snippets yet.</p>}
      </div>
      <div className="feature-editor">
        {current?<div className="snippet-form">
          <label>Name<input value={current.Name} placeholder="Example: Update packages"
            onChange={e=>setCurrent({...current,Name:e.target.value})}/></label>
          <label>Command<textarea value={current.Command} rows={10}
            spellCheck={false} placeholder="sudo apt update"
            onChange={e=>setCurrent({...current,Command:e.target.value})}/></label>
          {error&&<div className="inline-error">{error}</div>}
          <div className="snippet-actions">
            <button className="secondary-button danger-action" onClick={remove}><Trash2 size={16}/> Delete</button>
            <button className="primary-button" onClick={save}><Save size={16}/> Save snippet</button>
          </div>
        </div>:<div className="feature-empty large">Select a snippet, or create a new one.</div>}
      </div>
    </div>
  </div>;
}
