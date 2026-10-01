type PreviewBinding={ref:string;deploymentOrigin:string;branchOrigin:string};
export function adminPreviewBinding():PreviewBinding{return {ref:process.env.NEXT_PUBLIC_ADMIN_MODE_ISOLATED_DB_REF||"",deploymentOrigin:process.env.NEXT_PUBLIC_ADMIN_MODE_DEPLOYMENT_ORIGIN||"",branchOrigin:process.env.NEXT_PUBLIC_ADMIN_MODE_BRANCH_ORIGIN||""};}
export function validAdminPreviewRef(ref:string){return /^[a-z]{20}$/.test(ref)&&!["bymeopxkxapfizeeqeyb","zhqmlpljloumldaczcfp"].includes(ref);}
export function isAdminPreviewOrigin(origin:string,binding=adminPreviewBinding()){
  if(!validAdminPreviewRef(binding.ref))return false;
  try{const url=new URL(origin);return url.protocol==="https:"&&url.hostname.endsWith(".vercel.app")&&!url.port&&!url.username&&!url.password&&url.pathname==="/"&&!url.search&&!url.hash&&[binding.deploymentOrigin,binding.branchOrigin].includes(url.origin);}catch{return false;}
}
