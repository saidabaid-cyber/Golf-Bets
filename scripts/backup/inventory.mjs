import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from './core.mjs';

export async function environmentInventory(repo) {
  const files=(await command('git',['ls-files','-z'],{cwd:repo})).split('\0').filter(f=>/^(app|lib|scripts)\/.+\.(?:[cm]?[jt]sx?)$/.test(f)&&!f.startsWith('scripts/backup/'));
  const variables=new Map();
  for(const file of files){const text=await readFile(resolve(repo,file),'utf8');
    for(const match of text.matchAll(/\b(?:process\.env|env)\s*(?:\.([A-Z][A-Z0-9_]+)|\[\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\])/g)){
      const name=match[1]||match[2];if(!variables.has(name))variables.set(name,new Set());variables.get(name).add(file);
    }
  }
  return [...variables].sort(([a],[b])=>a.localeCompare(b)).map(([name,files])=>({name,files:[...files],runtime:[...files].some(f=>/^(app|lib)\//.test(f))}));
}
export async function migrationInventory(repo) {
  return (await readdir(resolve(repo,'supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log(JSON.stringify({variables:await environmentInventory(fileURLToPath(new URL('../../',import.meta.url))),migrations:await migrationInventory(fileURLToPath(new URL('../../',import.meta.url)))},null,2));
