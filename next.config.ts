import type { NextConfig } from "next";
import {adminModeDatabaseIsolated} from "./lib/admin-mode";
const isolatedAdminBuild=adminModeDatabaseIsolated();

const nextConfig: NextConfig = {
  env:{
    NEXT_PUBLIC_ADMIN_MODE_ISOLATED_DB_REF:isolatedAdminBuild?process.env.ADMIN_MODE_DB_REF||process.env.ADMIN_MODE_ISOLATED_DB_REF||"":"",
    NEXT_PUBLIC_ADMIN_MODE_TARGET_ENV:isolatedAdminBuild?process.env.ADMIN_MODE_TARGET_ENV||"qa":"",
    NEXT_PUBLIC_ADMIN_MODE_DEPLOYMENT_ORIGIN:isolatedAdminBuild&&process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:"",
    NEXT_PUBLIC_ADMIN_MODE_BRANCH_ORIGIN:isolatedAdminBuild&&process.env.VERCEL_BRANCH_URL?`https://${process.env.VERCEL_BRANCH_URL}`:"",
  },
  async headers() {
    return [{ source: "/sw.js", headers: [
      { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
      { key: "Service-Worker-Allowed", value: "/" },
    ] }];
  },
};

export default nextConfig;
