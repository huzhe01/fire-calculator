import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const files=readdirSync(root);
assert.ok(files.includes('index.html'),'Missing dist/index.html');
for(const file of files.filter(name=>name.endsWith('.mjs'))){
  const full=resolve(root,file);
  execFileSync(process.execPath,['--check',full],{stdio:'pipe'});
  const source=readFileSync(full,'utf8');
  for(const [,path] of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)){
    assert.ok(path.startsWith('./'),'Browser modules must use local relative imports: '+path);
    assert.ok(existsSync(resolve(dirname(full),path)),'Missing module: '+path);
  }
}
const html=readFileSync(resolve(root,'index.html'),'utf8');
assert.match(html,/<title>[^<]+<\/title>/);
assert.match(html,/name="viewport"/);
for(const [,path] of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
  if(/^(https?:|data:)/.test(path))continue;
  assert.ok(path.startsWith('./'),'Asset path must support the /fire-calculator/ prefix: '+path);
  const full=resolve(root,path);
  assert.ok(!relative(root,full).startsWith('..'),'Asset escapes dist: '+path);
  assert.ok(existsSync(full),'Missing asset: '+path);
}
console.log('PASS: JavaScript syntax, local module imports, metadata and GitHub Pages asset paths.');
