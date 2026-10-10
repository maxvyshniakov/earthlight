import {readFile} from 'node:fs/promises';
import {dirname,extname,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const sourceRoot=fileURLToPath(new URL('../src/',import.meta.url));

// Bundle the small local production modules used by GPU fixtures. Resolve real
// dependencies instead of substituting export-shaped mocks in the browser.
// This deliberately does not resolve packages or run application entry points.
export async function browserModule(name,{transform=source=>source}={}){
 const modules=new Map();
 const visit=async file=>{
  const path=resolve(file),id=relative(sourceRoot,path).split(sep).join('/');
  if(id.startsWith('../')||id==='..')throw Error(`Fixture module escapes src: ${path}`);
  if(modules.has(id))return id;
  modules.set(id,null);
  const source=await readFile(path,'utf8');
  if(extname(path)==='.json'){
   modules.set(id,`function(module){module.exports=${JSON.stringify(JSON.parse(source))};}`);
   return id;
  }
  if(extname(path)!=='.ts')throw Error(`Unsupported fixture module: ${path}`);
  const code=ts.transpileModule(transform(source,id),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const ast=ts.createSourceFile(id,code,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS),requests=new Set();
  const scan=node=>{
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='require'){
    if(node.arguments.length!==1||!ts.isStringLiteral(node.arguments[0]))throw Error(`Dynamic fixture import in ${id}`);
    requests.add(node.arguments[0].text);
   }
   ts.forEachChild(node,scan);
  };
  scan(ast);
  const dependencies={};
  for(const request of requests){
   if(!request.startsWith('./')&&!request.startsWith('../'))throw Error(`Nonlocal fixture import ${request} in ${id}`);
   const target=resolve(dirname(path),extname(request)?request:`${request}.ts`);
   dependencies[request]=await visit(target);
  }
  modules.set(id,`function(module,exports,load){const dependencies=${JSON.stringify(dependencies)};const require=name=>{if(!Object.hasOwn(dependencies,name))throw Error('Unknown fixture dependency '+name);return load(dependencies[name]);};\n${code}\n}`);
  return id;
 };
 const entry=await visit(resolve(sourceRoot,'scripts',extname(name)?name:`${name}.ts`));
 return `(()=>{const factories={${[...modules].map(([id,body])=>`${JSON.stringify(id)}:${body}`).join(',')}},cache={};const load=id=>{if(Object.hasOwn(cache,id))return cache[id].exports;const module={exports:{}};cache[id]=module;factories[id](module,module.exports,load);return module.exports;};return load(${JSON.stringify(entry)});})()`;
}
