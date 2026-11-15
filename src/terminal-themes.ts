import type {ITheme} from '@xterm/xterm';
export const TERMINAL_THEME_KEY='shiroterm:terminal-themes:v1';
export const DEFAULT_TERMINAL_THEME='aurora';
export type TerminalThemeId='aurora'|'midnight'|'graphite'|'nord'|'ember'|'paper';
export type TerminalTheme={id:TerminalThemeId;name:string;subtitle:string;theme:ITheme;accent:string};
export const TERMINAL_THEMES:readonly TerminalTheme[]=[
  {
    id:'aurora',name:'Shiro Aurora',subtitle:'Cool midnight · teal & lavender',accent:'#72e4cf',
    theme:{
      background:'#111927',foreground:'#e1eaf7',cursor:'#78e6d4',cursorAccent:'#111927',
      selectionBackground:'#3c6780aa',selectionInactiveBackground:'#334c6077',
      black:'#293750',red:'#fa788c',green:'#74d5b1',yellow:'#f6c77d',
      blue:'#75b9ff',magenta:'#cf9af7',cyan:'#76d7e2',white:'#c9d5e8',
      brightBlack:'#617087',brightRed:'#ff9aaa',brightGreen:'#a5e9c7',
      brightYellow:'#ffe09e',brightBlue:'#a5d4ff',brightMagenta:'#e6b9ff',
      brightCyan:'#a2f0f1',brightWhite:'#f5f9ff'
    }
  },
  {
    id:'midnight',name:'Cobalt Night',subtitle:'Deep navy · crisp electric blue',accent:'#6f9dff',
    theme:{
      background:'#0c1221',foreground:'#dce7fc',cursor:'#78aaff',cursorAccent:'#101729',
      selectionBackground:'#375aa299',selectionInactiveBackground:'#33456d77',
      black:'#253149',red:'#ff738d',green:'#7bd9a8',yellow:'#eccf86',
      blue:'#6b9dff',magenta:'#ba92f4',cyan:'#71c9ff',white:'#c4d1e7',
      brightBlack:'#65738e',brightRed:'#ff9ab0',brightGreen:'#a0f1ca',
      brightYellow:'#ffe3a7',brightBlue:'#9fc1ff',brightMagenta:'#e0b5ff',
      brightCyan:'#9be7ff',brightWhite:'#f5f8ff'
    }
  },
  {
    id:'graphite',name:'Obsidian',subtitle:'Near-black · clean high contrast',accent:'#f0b66e',
    theme:{
      background:'#101112',foreground:'#e4e5e6',cursor:'#f0bc78',cursorAccent:'#101112',
      selectionBackground:'#64605c99',selectionInactiveBackground:'#49474588',
      black:'#33373d',red:'#ff7e83',green:'#b2d783',yellow:'#eec980',
      blue:'#91b8f4',magenta:'#cf9af5',cyan:'#90d5cc',white:'#d0d3d7',
      brightBlack:'#777c83',brightRed:'#ffa1a4',brightGreen:'#d0eba2',
      brightYellow:'#ffdfa0',brightBlue:'#bad3ff',brightMagenta:'#e5c0ff',
      brightCyan:'#b3f0e6',brightWhite:'#ffffff'
    }
  },
  {
    id:'nord',name:'Nord Frost',subtitle:'Soft slate · arctic blues',accent:'#8bd4e6',
    theme:{
      background:'#242e3e',foreground:'#e5edf6',cursor:'#90d7e3',cursorAccent:'#242e3e',
      selectionBackground:'#506783aa',selectionInactiveBackground:'#44576c88',
      black:'#38475a',red:'#f08d9b',green:'#a4d3b0',yellow:'#f0d69b',
      blue:'#91c3ec',magenta:'#c6b0e2',cyan:'#95dae2',white:'#d3dfeb',
      brightBlack:'#8392a7',brightRed:'#ffafbb',brightGreen:'#c5e9cc',
      brightYellow:'#ffecb6',brightBlue:'#badcfa',brightMagenta:'#e3cdf4',
      brightCyan:'#c0f1f0',brightWhite:'#ffffff'
    }
  },
  {
    id:'ember',name:'Copper Ember',subtitle:'Warm dark · amber & jade',accent:'#ffc184',
    theme:{
      background:'#1b171b',foreground:'#f0e5dc',cursor:'#ffbd83',cursorAccent:'#1b171b',
      selectionBackground:'#80563b99',selectionInactiveBackground:'#60463688',
      black:'#3b3237',red:'#ff8a80',green:'#a9d595',yellow:'#ffc184',
      blue:'#98bce9',magenta:'#e8a9ca',cyan:'#8fd9cf',white:'#e4d7cd',
      brightBlack:'#85777c',brightRed:'#ffaea4',brightGreen:'#c8ebaf',
      brightYellow:'#ffe0a8',brightBlue:'#bdd6ff',brightMagenta:'#ffc5e3',
      brightCyan:'#b9f2e2',brightWhite:'#fff8ee'
    }
  },
  {
    id:'paper',name:'Alpine Paper',subtitle:'Bright minimal · ink blue & jade',accent:'#147d90',
    theme:{
      background:'#f3f5f9',foreground:'#24334b',cursor:'#18658b',cursorAccent:'#ffffff',
      selectionBackground:'#91bdeab0',selectionInactiveBackground:'#c3d5e388',
      black:'#2e4059',red:'#b32642',green:'#1b7251',yellow:'#8d5c08',
      blue:'#275fa8',magenta:'#8545a4',cyan:'#147d90',white:'#68788b',
      brightBlack:'#69778a',brightRed:'#d02f4a',brightGreen:'#188260',
      brightYellow:'#98660c',brightBlue:'#376ec0',brightMagenta:'#9a52b9',
      brightCyan:'#117f94',brightWhite:'#25354c'
    }
  }
] as const;
export const TERMINAL_THEME_BY_ID=Object.fromEntries(
  TERMINAL_THEMES.map(p=>[p.id,p])) as Record<TerminalThemeId,TerminalTheme>;
export const isTerminalThemeId=(value:unknown):value is TerminalThemeId=>
  typeof value==='string'&&Object.prototype.hasOwnProperty.call(TERMINAL_THEME_BY_ID,value);
export type TerminalThemePreferences={defaultId:TerminalThemeId;mainId:TerminalThemeId;byHost:Record<string,TerminalThemeId>};
export const defaultThemePreferences=():TerminalThemePreferences=>({
  defaultId:DEFAULT_TERMINAL_THEME,mainId:DEFAULT_TERMINAL_THEME,byHost:{}
});
export function parseThemePreferences(raw:unknown):TerminalThemePreferences {
  const prefs=defaultThemePreferences();
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return prefs;
  const input=raw as Record<string,unknown>;
  if(isTerminalThemeId(input.defaultId))prefs.defaultId=input.defaultId;
  prefs.mainId=isTerminalThemeId(input.mainId)?input.mainId:prefs.defaultId;
  if(input.byHost&&typeof input.byHost==='object'&&!Array.isArray(input.byHost)){
    for(const [id,value] of Object.entries(input.byHost)){
      if(id.length>0&&id.length<=100&&
        !['__proto__','constructor','prototype'].includes(id)&&isTerminalThemeId(value))
        prefs.byHost[id]=value;
    }
  }
  return prefs;
}
export function readThemePreferences():TerminalThemePreferences {
  try{return parseThemePreferences(JSON.parse(localStorage.getItem(TERMINAL_THEME_KEY)||'null'));}
  catch{return defaultThemePreferences();}
}
export function saveThemePreferences(prefs:TerminalThemePreferences) {
  try{localStorage.setItem(TERMINAL_THEME_KEY,JSON.stringify(prefs));}catch{}
}
