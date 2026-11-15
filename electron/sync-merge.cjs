'use strict';
// Conservative three-way merge. Never auto-resolve concurrent edits to the same entry.
const SECTIONS=['Sessions','Folders','Credentials','Macros'];
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
function canonical(value){
  if(value===undefined)return '__missing__';
  if(value===null || typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
const equal=(a,b)=>canonical(a)===canonical(b);
function rowsMap(rows,label){
  if(!Array.isArray(rows))throw Error('Invalid '+label+' in synchronized profile');
  const result=new Map();
  for(const row of rows){
    if(!row || typeof row!=='object' || typeof row.Id!=='string' ||
       !row.Id || row.Id.length>100 || result.has(row.Id))
      throw Error('Invalid or duplicate '+label+' identifier');
    result.set(row.Id,row);
  }
  return result;
}
function mergeRecords(baseRows,localRows,remoteRows,label,conflicts){
  const b=rowsMap(baseRows,label),l=rowsMap(localRows,label),r=rowsMap(remoteRows,label);
  const ids=new Set([...l.keys(),...r.keys(),...b.keys()]);
  const picked=new Map();
  for(const id of ids){
    const before=b.get(id),local=l.get(id),remote=r.get(id);
    const localChanged=!equal(before,local),remoteChanged=!equal(before,remote);
    if(localChanged && remoteChanged && !equal(local,remote)){
      conflicts.push({section:label,id,
        name:String(local?.Name||remote?.Name||before?.Name||id).slice(0,128)});
    }else{
      const value=localChanged?local:remote;
      if(value!==undefined)picked.set(id,copy(value));
    }
  }
  // Order local items first, then items newly seen on other devices.
  const ordered=[];
  for(const id of [...l.keys(),...r.keys()]){
    if(picked.has(id)){ordered.push(picked.get(id));picked.delete(id);}
  }
  return ordered;
}
function mergeProfiles(base,local,remote){
  const conflicts=[],merged={imported:true};
  for(const section of SECTIONS)
    merged[section]=mergeRecords(base[section],local[section],remote[section],section,conflicts);
  const key='ThemePreferences';
  const localChanged=!equal(base[key],local[key]);
  const remoteChanged=!equal(base[key],remote[key]);
  if(localChanged && remoteChanged && !equal(local[key],remote[key]))
    conflicts.push({section:key,id:'theme',name:'Application themes'});
  merged[key]=copy(localChanged?local[key]:remote[key])??null;
  return {merged,conflicts};
}
module.exports={mergeProfiles,equal,SECTIONS};
