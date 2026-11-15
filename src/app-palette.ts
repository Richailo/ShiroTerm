import type {CSSProperties} from 'react';
import {TERMINAL_THEME_BY_ID,type TerminalThemeId} from './terminal-themes.ts';
function blend(a:string,b:string,weight:number){
  const channels=[1,3,5].map(i=>Math.round(
    parseInt(a.slice(i,i+2),16)*(1-weight)+parseInt(b.slice(i,i+2),16)*weight));
  return '#'+channels.map(n=>n.toString(16).padStart(2,'0')).join('');
}
export type UiPalette=CSSProperties&Record<`--ui-${string}`,string>;
export function appPalette(id:TerminalThemeId):UiPalette {
  const palette=TERMINAL_THEME_BY_ID[id];
  const terminal=palette.theme;
  const bg=terminal.background!;
  const fg=terminal.foreground!;
  const light=id==='paper';
  const mix=(w:number)=>blend(bg,fg,w);
  return {
    '--ui-bg':mix(light?0.012:0.055),
    '--ui-title':mix(light?0.042:0.023),
    '--ui-sidebar':mix(light?0.065:0.105),
    '--ui-surface':mix(light?0.035:0.10),
    '--ui-raised':mix(light?0.09:0.155),
    '--ui-hover':mix(light?0.16:0.23),
    '--ui-active':mix(light?0.14:0.25),
    '--ui-input':mix(light?0.015:0.12),
    '--ui-edge':mix(light?0.23:0.28),
    '--ui-text':fg,
    '--ui-muted':mix(light?0.67:0.72),
    '--ui-subtle':mix(light?0.55:0.59),
    '--ui-accent':palette.accent,
    '--ui-primary-ink':light?'#ffffff':'#131821',
    '--ui-code-bg':bg,
    '--ui-code-ink':fg,
    '--ui-success':terminal.green!,
    '--ui-warning':terminal.yellow!,
    '--ui-danger':terminal.red!,
  };
}
