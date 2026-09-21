import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from './core.mjs';

// High confidence patterns only. Findings never contain matched values.
export function secretKinds(text) {
  const kinds=[];
  for(const [kind,re] of [
    ['PRIVATE_KEY',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ['GITHUB_TOKEN',/\b(?:gh[pousr]_[a-zA-Z0-9]{32,}|github_pat_[a-zA-Z0-9_]{60,})\b/],
    ['OPENAI_KEY',/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b/],
    ['SUPABASE_SECRET',/\bsb_secret_[A-Za-z0-9_-]{24,}\b/],
    ['AWS_ACCESS_KEY',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ['RESEND_KEY',/\bre_[A-Za-z0-9]{28,}\b/],
    ['DATABASE_PASSWORD_URI',/postgres(?:ql)?:\/\/[^\s:'"<>]+:([^\s@'"<>]{12,})@/],
  ]) if(re.test(text))kinds.push(kind);
  for(const m of text.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{25,})/g)) {
    try {if(JSON.parse(Buffer.from(m[1],'base64url')).role==='service_role')kinds.push('SUPABASE_SERVICE_ROLE_JWT');}catch{/* not a JWT */}
  }
  return [...new Set(kinds)];
}
export async function scanTracked(repo,{history=false}={}) {
  const files=(await command('git',['ls-files','-z'],{cwd:repo})).split('\0').filter(Boolean);
  const findings=[]; let scanned=0;
  const relevant=p=>/(?:\.(?:[cm]?[jt]sx?|json|ya?ml|sql|md|toml|txt|sh|ps1|pem|key|env)|(?:^|\/)\.env[^/]*)$/i.test(p);
  for(const path of files.filter(relevant)){
    const text=await readFile(resolve(repo,path),'utf8');scanned++;
    for(const kind of secretKinds(text))findings.push({file:path,kind,action:'REVIEW_AND_ROTATE_IF_REAL'});
  }
  if(history){
    const objects=(await command('git',['rev-list','--objects','--all'],{cwd:repo})).split('\n').map(line=>{const i=line.indexOf(' ');return{id:line.slice(0,i),path:line.slice(i+1)};}).filter(x=>/^[a-f0-9]{40,64}$/.test(x.id)&&relevant(x.path));
    for(const object of objects){const text=await command('git',['cat-file','blob',object.id],{cwd:repo});scanned++;for(const kind of secretKinds(text))findings.push({file:object.path,objectId:object.id,kind,action:'REVIEW_AND_ROTATE_IF_REAL'});}
  }
  return {state:findings.length?'POTENTIAL_SECRET_EXPOSURE':'PASS',scope:history?'tracked worktree + all reachable relevant Git blobs':'tracked worktree relevant text files',scanned,findings};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await scanTracked(fileURLToPath(new URL('../../',import.meta.url)),{history:process.argv.includes('--history')});console.log(JSON.stringify(result,null,2));process.exitCode=result.findings.length?1:0;}
  catch{console.error('SECURITY_SCAN_INCOMPLETE. No secret values printed.');process.exitCode=2;}
}
