const windowsPath=(value:string)=>/^[a-z]:[\\/]|^\\\\/i.test(value);

export function localJoin(folder:string,name:string):string {
  return folder.replace(/[\\/]+$/,'')+(windowsPath(folder)?'\\':'/')+name;
}

export function parentLocal(folder:string):string {
  if(!folder)return folder;
  const windows=windowsPath(folder);
  const normalized=folder.replace(/[\\/]+$/,'');
  if(windows&&/^[a-z]:$/i.test(normalized))return normalized+'\\';
  if(windows&&/^\\\\[^\\]+\\[^\\]+$/.test(normalized))return normalized;
  const index=windows?Math.max(normalized.lastIndexOf('\\'),normalized.lastIndexOf('/')):
    normalized.lastIndexOf('/');
  if(index<=0)return windows?folder:'/';
  if(windows&&index===2&&normalized[1]===':')return normalized.slice(0,3);
  return normalized.slice(0,index);
}
