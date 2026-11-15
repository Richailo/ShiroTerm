import type {Session} from './types';

/** Stable in-memory ordering; SSH sessions, streams and IDs are never recreated. */
export function moveSession(sessions:Session[],fromId:string,toId:string):Session[]{
  const from=sessions.findIndex(s=>s.id===fromId);
  const to=sessions.findIndex(s=>s.id===toId);
  if(from<0||to<0||from===to)return sessions;
  const next=sessions.slice();
  const [item]=next.splice(from,1);
  next.splice(to,0,item);
  return next;
}
export type CloseScope='one'|'others'|'right';
export function sessionIdsToClose(sessions:Session[],id:string,scope:CloseScope):string[]{
  const index=sessions.findIndex(s=>s.id===id);
  if(index<0)return [];
  if(scope==='one')return [id];
  if(scope==='others')return sessions.filter(s=>s.id!==id).map(s=>s.id);
  return sessions.slice(index+1).map(s=>s.id);
}
export function nextTabId(sessions:Session[],activeTab:string,direction:1|-1):string{
  const ids=['hosts',...sessions.map(s=>s.protocol==='SFTP'?'sftp:'+s.id:s.id)];
  if(ids.length===1)return 'hosts';
  const current=ids.indexOf(activeTab);
  const hostSessionId=activeTab.startsWith('sftp:')?activeTab.slice(5):activeTab;
  const related=ids.indexOf(hostSessionId);
  const index=current>=0?current:related>=0?related:0;
  return ids[(index+direction+ids.length)%ids.length];
}
