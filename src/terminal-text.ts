import type {IBuffer} from '@xterm/xterm';
export const MAX_TERMINAL_COPY=8*1024*1024;
// Copy the rendered terminal buffer (including scrollback), never raw transport history.
// Wrapped screen rows are joined and trailing blank viewport rows are removed.
export function copyTerminalBuffer(buffer:Pick<IBuffer,'length'|'getLine'>){
  const lines:string[]=[];
  let total=0;
  let truncated=false;
  for(let i=0;i<buffer.length;i++){
    const row=buffer.getLine(i);
    if(!row)continue;
    const raw=row.translateToString(true);
    const prefix=row.isWrapped?'':'\n';
    const candidate=(lines.length?prefix:'')+raw;
    if(total+candidate.length>MAX_TERMINAL_COPY){
      const space=MAX_TERMINAL_COPY-total;
      if(space>0)lines.push(candidate.slice(0,space));
      truncated=true;
      break;
    }
    lines.push(candidate);
    total+=candidate.length;
  }
  return {text:lines.join('').replace(/\n+$/,''),truncated};
}
