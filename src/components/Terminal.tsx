import {useEffect,useRef,useState,type MouseEvent} from 'react';
import {Check,Copy,ClipboardCopy,ClipboardPaste,AlertCircle} from 'lucide-react';
import {Terminal as Xterm,type IDisposable} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type {SshEvent} from '../types';
import {TERMINAL_THEME_BY_ID,type TerminalThemeId} from '../terminal-themes';
import {semanticSpans,type SemanticKind} from '../terminal-semantics';
import {copyTerminalBuffer} from '../terminal-text';
interface Props {
  sessionId:string;
  active:boolean;
  themeId:TerminalThemeId;
  onEvent:(handler:(e:SshEvent)=>void)=>()=>void;
}
export default function Terminal({sessionId,active,themeId,onEvent}:Props){
  const host=useRef<HTMLDivElement>(null);
  const terminal=useRef<Xterm|null>(null);
  const fitRef=useRef<FitAddon|null>(null);
  const colorRef=useRef(themeId);
  colorRef.current=themeId;
  const refreshSemantic=useRef<()=>void>(()=>{});
  const [context,setContext]=useState<{x:number;y:number}|null>(null);
  const [copied,setCopied]=useState('');
  const [pasteError,setPasteError]=useState('');
  const openContext=(event:MouseEvent<HTMLDivElement>)=>{
    event.preventDefault();
    if(!active)return;
    const rect=event.currentTarget.getBoundingClientRect();
    setCopied('');setPasteError('');
    setContext({x:Math.max(8,Math.min(rect.width-221,event.clientX-rect.left)),
      y:Math.max(8,Math.min(rect.height-141,event.clientY-rect.top))});
  };
  const copy=(all:boolean)=>{
    const xterm=terminal.current;
    if(!xterm)return;
    const copyResult=all?copyTerminalBuffer(xterm.buffer.normal):null;
    const text=copyResult?copyResult.text:xterm.getSelection();
    if(!text)return;
    void window.shiro.copyText(text).then(()=>{
      setCopied(copyResult?.truncated?'Copied first 8 MB':'Copied');
      setContext(null);
    }).catch(()=>{setContext(null);});
  };
  const paste=async()=>{
    setContext(null);setPasteError('');setCopied('');
    const xterm=terminal.current;
    if(!xterm||!active)return;
    try{
      const data=await window.shiro.readClipboard();
      if(!data){setPasteError('Clipboard is empty');return;}
      // Without bracketed paste, newlines can execute remote commands.
      // Ask first rather than silently executing multiple shell lines.
      if(/[\r\n]/.test(data)&&!window.confirm(
        'Paste multiple lines into the terminal? Newlines may execute remote commands.'
      ))return;
      xterm.paste(data);
      xterm.focus();
      setCopied('Pasted');
    }catch(e){
      setPasteError(e instanceof Error?e.message:String(e));
    }
  };
  useEffect(()=>{
    if(!active||!host.current)return;
    const shortcut=(event:KeyboardEvent)=>{
      if((event.ctrlKey||event.metaKey)&&event.shiftKey&&
        event.key.toLowerCase()==='v'){
        event.preventDefault();event.stopPropagation();
        void paste();
      }
    };
    const node=host.current;
    node.addEventListener('keydown',shortcut,true);
    return ()=>node.removeEventListener('keydown',shortcut,true);
  },[active,sessionId]);
  useEffect(()=>{
    if(!host.current)return;
    const xterm=new Xterm({
      cursorBlink:true,allowTransparency:false,allowProposedApi:true,
      theme:TERMINAL_THEME_BY_ID[themeId].theme,
      minimumContrastRatio:4.5,
      drawBoldTextInBrightColors:true,
      fontFamily:'"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, monospace',fontSize:13.5,
      lineHeight:1.28,scrollback:10000,convertEol:false
    });
    const fit=new FitAddon();xterm.loadAddon(fit);
    xterm.open(host.current);terminal.current=xterm;fitRef.current=fit;
    // Decorations recolor default-foreground cells without modifying SSH output,
    // terminal escape sequences, shell prompts or copied text.
    const rows=new Map<number,{text:string;handles:IDisposable[]}>();
    const clearRows=()=>{
      for(const entry of rows.values())for(const handle of entry.handles)handle.dispose();
      rows.clear();
    };
    const recolor=()=>{
      const buffer=xterm.buffer.active;
      if(buffer.type!=='normal'){clearRows();return;}
      const cursor=buffer.baseY+buffer.cursorY;
      const start=Math.max(0,cursor-35);
      for(const [index,entry] of rows){
        if(index<start||index>cursor||index>=buffer.length){
          for(const handle of entry.handles)handle.dispose();
          rows.delete(index);
        }
      }
      const theme=TERMINAL_THEME_BY_ID[colorRef.current].theme;
      const semanticColor:Record<SemanticKind,string>={
        error:theme.red!,warning:theme.yellow!,success:theme.green!,
        address:theme.cyan!,url:theme.blue!,path:theme.magenta!,
        timestamp:theme.brightBlack!,number:theme.brightYellow!
      };
      for(let index=start;index<=cursor&&index<buffer.length;index++){
        const line=buffer.getLine(index);
        if(!line||line.isWrapped)continue;
        const text=line.translateToString(true);
        if(rows.get(index)?.text===text)continue;
        const old=rows.get(index);
        if(old)for(const h of old.handles)h.dispose();
        const handles:IDisposable[]=[];
        for(const span of semanticSpans(text)){
          if(span.start+span.length>xterm.cols)continue;
          // Honor server-provided ANSI colors and avoid wide/combining glyph offsets.
          let plain=true;
          for(let x=span.start;x<span.start+span.length;x++){
            const cell=line.getCell(x);
            if(!cell||cell.getFgColorMode()!==0){plain=false;break;}
          }
          if(!plain)continue;
          const marker=xterm.registerMarker(index-cursor);
          if(!marker)continue;
          handles.push(marker);
          const decoration=xterm.registerDecoration({marker,x:span.start,
            width:span.length,foregroundColor:semanticColor[span.kind],
            layer:'bottom'});
          if(decoration)handles.push(decoration);
        }
        rows.set(index,{text,handles});
      }
    };
    const parsed=xterm.onWriteParsed(recolor);
    refreshSemantic.current=()=>{clearRows();recolor();};

    let retrying=false;
    const input=xterm.onData(data=>window.shiro.write(sessionId,data).catch(()=>{}));
    const stop=onEvent(event=>{
      if(event.sessionId!==sessionId)return;
      if(event.type==='data' && event.data)xterm.write(event.data);
      if(event.type==='error')xterm.writeln('\r\n\x1b[31m'+event.message+'\x1b[0m');
      if(event.type==='status' && event.status==='closed')
        xterm.writeln('\r\n\x1b[90m[Disconnected]\x1b[0m');
      if(event.type==='status' && event.status==='reconnect-wait'){
        retrying=true;
        xterm.writeln('\r\n\x1b[33m[Retry '+event.attempt+'/'+event.maxAttempts+
          ' in '+Math.ceil((event.delayMs||0)/1000)+'s]\x1b[0m');
      }
      if(event.type==='status' && event.status==='reconnect-exhausted')
        xterm.writeln('\r\n\x1b[31m[Automatic reconnection stopped after reaching the limit]\x1b[0m');
      if(event.type==='status' && event.status==='reconnect-stopped')
        xterm.writeln('\r\n\x1b[90m[Automatic reconnection cancelled]\x1b[0m');
      if(event.type==='status' && event.status==='shell-ready' && retrying){
        retrying=false;
        xterm.writeln('\r\n\x1b[32m[Reconnected]\x1b[0m');
      }
    });
    // Rehydrate output emitted before this lazy-loaded terminal mounted.
    const previous=window.shiro.terminalHistory(sessionId);
    if(previous)xterm.write(previous);
    let animation=0;
    const measure=()=>{
      cancelAnimationFrame(animation);
      animation=requestAnimationFrame(()=>{
        if(!host.current || !host.current.offsetWidth)return;
        fit.fit();
        window.shiro.resize(sessionId,xterm.cols,xterm.rows).catch(()=>{});
      });
    };
    const observer=new ResizeObserver(measure);
    observer.observe(host.current);
    measure();xterm.focus();
    return ()=>{
      observer.disconnect();cancelAnimationFrame(animation);stop();input.dispose();
      parsed.dispose();clearRows();refreshSemantic.current=()=>{};
      xterm.dispose();terminal.current=null;fitRef.current=null;
    };
  },[sessionId,onEvent]);
  useEffect(()=>{
    if(terminal.current){
      terminal.current.options.theme=TERMINAL_THEME_BY_ID[themeId].theme;
      refreshSemantic.current();
    }
  },[themeId]);
  useEffect(()=>{if(active){requestAnimationFrame(()=>{fitRef.current?.fit();terminal.current?.focus();});}},[active]);
  useEffect(()=>{
    if(!active)setContext(null);
  },[active]);
  useEffect(()=>{
    if(!context)return;
    const dismiss=(event:PointerEvent)=>{
      if(event.target instanceof Element&&event.target.closest('.terminal-context-menu'))return;
      setContext(null);
    };
    const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape')setContext(null);};
    window.addEventListener('pointerdown',dismiss,true);
    window.addEventListener('keydown',keyboard,true);
    return ()=>{
      window.removeEventListener('pointerdown',dismiss,true);
      window.removeEventListener('keydown',keyboard,true);
    };
  },[context]);
  return <div className="terminal-view" ref={host} onContextMenu={openContext}
    style={{display:active?'block':'none',background:TERMINAL_THEME_BY_ID[themeId].theme.background}}>
    {context&&<div className="terminal-context-menu" role="menu" aria-label="Terminal context menu"
      style={{left:context.x,top:context.y}} onMouseDown={e=>e.preventDefault()}>
      <button role="menuitem" disabled={!terminal.current?.hasSelection()}
        onClick={()=>copy(false)}><Copy size={15}/> Copy <kbd>Selection</kbd></button>
      <button role="menuitem" onClick={()=>copy(true)}>
        <ClipboardCopy size={15}/> Copy All <kbd>Scrollback</kbd></button>
      <div className="terminal-context-divider"/>
      <button role="menuitem" onClick={()=>void paste()}>
        <ClipboardPaste size={15}/> Paste <kbd>Ctrl+Shift+V</kbd></button>
    </div>}
    {copied&&<span className="terminal-copied" role="status"><Check size={12}/> {copied}</span>}
    {pasteError&&<span className="terminal-paste-error" role="alert">
      <AlertCircle size={13}/>{pasteError}</span>}
  </div>;
}
