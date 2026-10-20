import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

async function snapshot(directory,prefix=''){
 const files=new Map();
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=join(directory,entry.name),name=prefix+entry.name;
  if(entry.isDirectory())for(const [key,value] of await snapshot(path,name+'/'))files.set(key,value);
  else if(entry.isFile())files.set(name,createHash('sha256').update(await readFile(path)).digest('hex'));
 }
 return files;
}
const before=await snapshot('docs');
const build=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['run','build:pages'],{stdio:'inherit'});
if(build.error)throw build.error;if(build.status!==0)process.exit(build.status??1);
const after=await snapshot('docs');
const changed=[...new Set([...before.keys(),...after.keys()])].filter(key=>before.get(key)!==after.get(key)).sort();
if(changed.length){
 console.error('Committed docs/ differs from the tested Pages source. Run npm run build:pages and include the generated files.\n'+changed.map(key=>'  '+key).join('\n'));
 process.exitCode=1;
}else console.log('Committed docs/ exactly matches the tested Pages build.');
