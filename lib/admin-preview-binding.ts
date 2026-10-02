type PreviewBinding={ref:string;deploymentOrigin:string;branchOrigin:string;target?:string};
export function adminPreviewBinding():PreviewBinding{return {ref:process.env.NEXT_PUBLIC_ADMIN_MODE_ISOLATED_DB_REF||"",deploymentOrigin:process.env.NEXT_PUBLIC_ADMIN_MODE_DEPLOYMENT_ORIGIN||"",branchOrigin:process.env.NEXT_PUBLIC_ADMIN_MODE_BRANCH_ORIGIN||"",target:process.env.NEXT_PUBLIC_ADMIN_MODE_TARGET_ENV||"qa"};}
export function validAdminPreviewRef(ref:string,target="qa"){return /^[a-z]{20}$/.test(ref)&&ref!=="zhqmlpljloumldaczcfp"&&(target==="qa"?ref!=="bymeopxkxapfizeeqeyb":target==="dev"&&ref==="bymeopxkxapfizeeqeyb");}
export function isAdminPreviewOrigin(origin:string,binding=adminPreviewBinding()){
  if(!validAdminPreviewRef(binding.ref,binding.target))return false;
  try{const url=new URL(origin);return url.protocol==="https:"&&!url.port&&!url.username&&!url.password&&url.pathname==="/"&&!url.search&&!url.hash&&((url.hostname.endsWith(".vercel.app")&&[binding.deploymentOrigin,binding.branchOrigin].includes(url.origin))||(binding.target==="dev"&&url.origin==="https://dev.thebackyard.com.mx"));}catch{return false;}
}
