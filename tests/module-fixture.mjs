import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const modules=new Map();
// Transpile first so type-only cycles disappear, then resolve local runtime imports.
export function moduleUrl(name,suffix=''){
 const key=name+'/'+suffix;if(modules.has(key))return modules.get(key);
 const pending=(async()=>{
  const source=await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8');
  let code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  for(const match of [...code.matchAll(/from ['"]\.\/([^'"]+)['"]/g)])code=code.replace(match[0],`from '${await moduleUrl(match[1])}'`);
  return 'data:text/javascript;base64,'+Buffer.from(code+'\n// '+suffix).toString('base64');
 })();modules.set(key,pending);return pending;
}
