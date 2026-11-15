'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {moveSession,sessionIdsToClose,nextTabId}=require('../src/tab-operations.ts');
const sessions=[
  {id:'alpha',protocol:'SSH',name:'A'},
  {id:'beta',protocol:'SFTP',name:'B'},
  {id:'gamma',protocol:'TELNET',name:'C'},
  {id:'delta',protocol:'SSH',name:'D'}
];
test('reordering sessions preserves original objects and connection identity',()=>{
  const next=moveSession(sessions,'alpha','gamma');
  assert.deepEqual(next.map(s=>s.id),['beta','gamma','alpha','delta']);
  assert.equal(next[2],sessions[0],'SSH session object is not recreated');
  assert.deepEqual(sessions.map(s=>s.id),['alpha','beta','gamma','delta'],
    'Original array must not be mutated');
  assert.equal(moveSession(sessions,'unknown','beta'),sessions);
  assert.equal(moveSession(sessions,'alpha','alpha'),sessions);
  assert.equal(moveSession(sessions,'beta','unknown'),sessions);
});
test('context close scopes never target unrelated tabs or Vaults',()=>{
  assert.deepEqual(sessionIdsToClose(sessions,'beta','one'),['beta']);
  assert.deepEqual(sessionIdsToClose(sessions,'beta','others'),
    ['alpha','gamma','delta']);
  assert.deepEqual(sessionIdsToClose(sessions,'beta','right'),['gamma','delta']);
  assert.deepEqual(sessionIdsToClose(sessions,'delta','right'),[]);
  assert.deepEqual(sessionIdsToClose(sessions,'nonexistent','others'),[]);
});
test('Ctrl+Tab cycles session tabs including SFTP and Vaults without mutation',()=>{
  assert.equal(nextTabId(sessions,'hosts',1),'alpha');
  assert.equal(nextTabId(sessions,'alpha',1),'sftp:beta');
  assert.equal(nextTabId(sessions,'sftp:beta',1),'gamma');
  assert.equal(nextTabId(sessions,'delta',1),'hosts');
  assert.equal(nextTabId(sessions,'sftp:alpha',1),'sftp:beta');
  assert.equal(nextTabId(sessions,'hosts',-1),'delta');
  assert.equal(nextTabId([], 'hosts',1),'hosts');
});
