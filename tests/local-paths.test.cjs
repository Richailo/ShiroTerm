'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {localJoin,parentLocal}=require('../src/local-paths.ts');

test('SFTP local pane navigates Linux directories including the filesystem root',()=>{
  assert.equal(localJoin('/home/user','docs'),'/home/user/docs');
  assert.equal(localJoin('/','tmp'),'/tmp');
  assert.equal(parentLocal('/home/user/'),'/home');
  assert.equal(parentLocal('/home'),'/');
  assert.equal(parentLocal('/'),'/');
});

test('SFTP local pane preserves Windows drives and UNC shares',()=>{
  assert.equal(localJoin('C:\\Users\\user','docs'),'C:\\Users\\user\\docs');
  assert.equal(localJoin('C:\\','tmp'),'C:\\tmp');
  assert.equal(parentLocal('C:\\Users'),'C:\\');
  assert.equal(parentLocal('C:\\'),'C:\\');
  assert.equal(parentLocal('\\\\server\\share\\docs'),'\\\\server\\share');
  assert.equal(parentLocal('\\\\server\\share'),'\\\\server\\share');
});
