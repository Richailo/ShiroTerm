import {useEffect,useRef} from 'react';
import {Check,Palette,Star} from 'lucide-react';
import {
  TERMINAL_THEMES,TERMINAL_THEME_BY_ID,type TerminalThemeId
} from '../terminal-themes';

export default function ThemePicker({themeId,defaultId,onSelect,onMakeDefault,onClose,embedded=false}:{
  themeId:TerminalThemeId;defaultId:TerminalThemeId;
  onSelect:(id:TerminalThemeId)=>void;
  onMakeDefault:()=>void;onClose:()=>void;embedded?:boolean;
}){
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(embedded)return;
    const outside=(event:PointerEvent)=>{
      if(event.target instanceof Element&&
        event.target.closest('.terminal-colors-button'))return;
      if(event.target instanceof Node&&!host.current?.contains(event.target))
        onClose();
    };
    const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();};
    document.addEventListener('pointerdown',outside);
    window.addEventListener('keydown',keyboard,true);
    return ()=>{
      document.removeEventListener('pointerdown',outside);
      window.removeEventListener('keydown',keyboard,true);
    };
  },[onClose,embedded]);
  const active=TERMINAL_THEME_BY_ID[themeId];
  return <div className={'theme-popover '+(embedded?'theme-inline':'')} ref={host} role="group" aria-label="Terminal color themes">
    <div className="theme-popover-header">
      <span><Palette size={16}/> Terminal appearance</span>
      <span className="theme-popover-subtitle">Choose a color palette</span>
    </div>
    <div className="theme-options">
      {TERMINAL_THEMES.map(palette=>{
        const t=palette.theme;
        return <button key={palette.id} type="button"
          aria-label={'Theme '+palette.name}
          aria-pressed={themeId===palette.id}
          className={'theme-choice '+(themeId===palette.id?'selected':'')}
          onClick={()=>onSelect(palette.id)}>
          <span className="theme-miniature" style={{background:t.background,color:t.foreground}}>
            <span className="theme-miniature-line" style={{color:t.green}}>➜ <span style={{color:t.cyan}}>~/projects</span></span>
            <span className="theme-miniature-command">
              <span style={{color:t.blue}}>git</span> status
            </span>
            <span className="theme-miniature-dots">
              {[t.red,t.yellow,t.green,t.blue,t.magenta,t.cyan].map((color,i)=>
                <i key={i} style={{background:color}}/>)}
            </span>
          </span>
          <span className="theme-choice-meta">
            <strong>{palette.name}{defaultId===palette.id&&<Star size={12} fill="currentColor"/>}</strong>
            <span>{palette.subtitle}</span>
          </span>
          {themeId===palette.id&&<Check className="theme-selected-check" size={16}/>}
        </button>;
      })}
    </div>
    <div className="theme-popover-footer">
      <div className="theme-current-swatch" style={{background:active.theme.background}}>
        <i style={{background:active.accent}}/></div>
      <span>{active.name}</span>
      <button type="button" className="theme-default-button"
        onClick={onMakeDefault} disabled={themeId===defaultId}>
        {themeId===defaultId?'Default':'Set as default'}
      </button>
    </div>
  </div>;
}
