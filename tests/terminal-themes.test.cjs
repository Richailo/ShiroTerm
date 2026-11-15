'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  TERMINAL_THEMES,DEFAULT_TERMINAL_THEME,TERMINAL_THEME_BY_ID,
  parseThemePreferences,isTerminalThemeId
}=require('../src/terminal-themes.ts');

const ansi=[
  'black','red','green','yellow','blue','magenta','cyan','white',
  'brightBlack','brightRed','brightGreen','brightYellow',
  'brightBlue','brightMagenta','brightCyan','brightWhite'
];
function luminance(hex){
  const components=hex.slice(1).match(/../g).map(v=>{
    const n=parseInt(v,16)/255;
    return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;
  });
  return components[0]*0.2126+components[1]*0.7152+components[2]*0.0722;
}
function contrast(a,b){
  const [lighter,darker]=[luminance(a),luminance(b)].sort((x,y)=>y-x);
  return (lighter+0.05)/(darker+0.05);
}
test('all ShiroTerm palettes are complete and have readable foreground contrast',()=>{
  assert.equal(TERMINAL_THEMES.length,6);
  assert.ok(isTerminalThemeId(DEFAULT_TERMINAL_THEME));
  const ids=new Set();
  for(const item of TERMINAL_THEMES){
    assert.ok(!ids.has(item.id),'Unique theme ID');
    ids.add(item.id);
    assert.equal(TERMINAL_THEME_BY_ID[item.id],item);
    for(const key of [...ansi,'foreground','background','cursor','cursorAccent']){
      assert.match(item.theme[key],/^#[\da-fA-F]{6}$/,item.name+' '+key);
    }
    assert.ok(contrast(item.theme.background,item.theme.foreground)>=7,
      item.name+' must have accessible normal text contrast');
    assert.ok(contrast(item.theme.background,item.theme.cursor)>=4.5,
      item.name+' must have visible caret contrast');
  }
});
test('theme preferences ignore invalid and stale values without losing valid host colors',()=>{
  const clean=parseThemePreferences({
    defaultId:'paper',byHost:{serverA:'ember',serverB:'hacked',other:'aurora',constructor:'nord'}
  });
  assert.equal(clean.defaultId,'paper');
  assert.equal(clean.mainId,'paper','Legacy default theme migrates into the main UI');
  assert.deepEqual(clean.byHost,{serverA:'ember',other:'aurora'});
  assert.equal(parseThemePreferences({defaultId:'bad'}).defaultId,DEFAULT_TERMINAL_THEME);
  assert.equal(parseThemePreferences('invalid').defaultId,DEFAULT_TERMINAL_THEME);
  const distinct=parseThemePreferences({mainId:'nord',defaultId:'aurora',byHost:{alpha:'ember'}});
  assert.equal(distinct.mainId,'nord');
  assert.equal(distinct.byHost.alpha,'ember');
  assert.equal(distinct.defaultId,'aurora');
  assert.ok(!isTerminalThemeId('javascript:alert(1)'));
});
