'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {semanticSpans}=require('../src/terminal-semantics.ts');
const {copyTerminalBuffer,MAX_TERMINAL_COPY}=require('../src/terminal-text.ts');
const {appPalette}=require('../src/app-palette.ts');

test('semantic terminal highlights differentiate IPs URLs paths and statuses without changing data',()=>{
  const raw='2026-10-28 ERROR: 192.0.2.220 failed /var/log/nginx/error.log https://example.org/health';
  const spans=semanticSpans(raw);
  const examples=spans.map(s=>[s.kind,raw.slice(s.start,s.start+s.length)]);
  assert.ok(examples.some(([k,v])=>k==='timestamp'&&v==='2026-10-28'));
  assert.ok(examples.some(([k,v])=>k==='error'&&v==='ERROR'));
  assert.ok(examples.some(([k,v])=>k==='address'&&v==='192.0.2.220'));
  assert.ok(examples.some(([k,v])=>k==='path'&&v==='/var/log/nginx/error.log'));
  assert.ok(examples.some(([k,v])=>k==='url'&&v==='https://example.org/health'));
  assert.ok(examples.every(([,v])=>raw.includes(v)),'Spans reference unchanged source bytes');
  assert.deepEqual(semanticSpans('host 300.1.1.1'),[]);
  assert.deepEqual(semanticSpans('terminal \x1b[2Jclear'),[]);
});
test('terminal copy-all keeps history and joins wrapped screen rows',()=>{
  const rows=[
    {isWrapped:false,translateToString:()=> 'one'},
    {isWrapped:true,translateToString:()=> 'two'},
    {isWrapped:false,translateToString:()=> 'IP 10.0.0.1'},
    {isWrapped:false,translateToString:()=> ''}
  ];
  const result=copyTerminalBuffer({length:rows.length,getLine:i=>rows[i]});
  assert.deepEqual(result,{text:'onetwo\nIP 10.0.0.1',truncated:false});
  assert.ok(MAX_TERMINAL_COPY>=1048576);
});
test('app UI and terminal use the same palette, including a fully light mode',()=>{
  const light=appPalette('paper');
  const dark=appPalette('aurora');
  assert.match(light['--ui-bg'],/^#[0-9a-f]{6}$/);
  assert.notEqual(light['--ui-bg'],dark['--ui-bg']);
  assert.equal(light['--ui-primary-ink'],'#ffffff');
  assert.notEqual(light['--ui-text'],dark['--ui-text']);
  assert.equal(light['--ui-accent'],'#147d90');
  assert.equal(appPalette('ember')['--ui-accent'],'#ffc184');
  assert.equal(appPalette('aurora')['--ui-accent'],'#72e4cf');
  assert.equal(appPalette('ember')['--ui-primary-ink'],'#131821');
});
