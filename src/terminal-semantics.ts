export type SemanticKind='error'|'warning'|'success'|'address'|'url'|'path'|'timestamp'|'number';
export type SemanticSpan={start:number;length:number;kind:SemanticKind};
const patterns:{kind:SemanticKind;pattern:RegExp}[]=[
  {kind:'url',pattern:/https?:\/\/[^\s"'<>()[\]]+/gi},
  {kind:'address',pattern:/\b(?:\d{1,3}\.){3}\d{1,3}\b/g},
  {kind:'timestamp',pattern:/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?\b/g},
  {kind:'path',pattern:/(?:^|\s)(\/(?:[\w.~-]+\/)+[\w.~-]*)/g},
  {kind:'error',pattern:/\b(?:error|failed|failure|fatal|critical|denied|exception)\b/gi},
  {kind:'warning',pattern:/\b(?:warning|warn|pending|degraded|timeout)\b/gi},
  {kind:'success',pattern:/\b(?:success|successful|connected|active|running|passed|enabled|online|ok)\b/gi},
  {kind:'number',pattern:/\b(?:\d+(?:\.\d+)?)(?:\s?(?:GiB|MiB|KiB|GB|MB|KB|ms|Mbps|Gbit|Mbit|%))\b/gi}
];
export function semanticSpans(text:string):SemanticSpan[]{
  // Never transform the output byte stream: these are display-only cell decorations.
  if(!text||text.length>500||/[\x00-\x08\x0b-\x1f\x7f]/.test(text))return [];
  const taken=new Set<number>();
  const out:SemanticSpan[]=[];
  for(const {kind,pattern} of patterns){
    pattern.lastIndex=0;
    for(const found of text.matchAll(pattern)){
      const value=found[1]&&kind==='path'?found[1]:found[0];
      const start=found.index+(found[1]&&kind==='path'?found[0].indexOf(value):0);
      const end=start+value.length;
      if(kind==='address'&&!value.split('.').every(n=>Number(n)<=255))continue;
      if(!value||/[^\x20-\x7e]/.test(text.slice(0,end)))continue;
      if([...Array(end-start).keys()].some(i=>taken.has(start+i)))continue;
      for(let i=start;i<end;i++)taken.add(i);
      out.push({start,length:value.length,kind});
      if(out.length>=14)return out.sort((a,b)=>a.start-b.start);
    }
  }
  return out.sort((a,b)=>a.start-b.start);
}
