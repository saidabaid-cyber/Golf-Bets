import type { NextConfig } from "next";
import {adminModeDatabaseIsolated} from "./lib/admin-mode";
import {cloudDiagnosticPreviewHost} from "./lib/cloud-diagnostic-host";
import {scorecardPreviewBinding} from "./lib/scorecard-preview-binding";
const isolatedAdminBuild=adminModeDatabaseIsolated();
const scorecardPreview=scorecardPreviewBinding(process.env);

const nextConfig: NextConfig = {
  env:{
    NEXT_PUBLIC_CLOUD_DIAGNOSTIC_PREVIEW_HOST:cloudDiagnosticPreviewHost(process.env),
    NEXT_PUBLIC_ADMIN_MODE_ISOLATED_DB_REF:scorecardPreview?.ref||(isolatedAdminBuild?process.env.ADMIN_MODE_DB_REF||process.env.ADMIN_MODE_ISOLATED_DB_REF||"":""),
    NEXT_PUBLIC_ADMIN_MODE_TARGET_ENV:scorecardPreview?.target||(isolatedAdminBuild?process.env.ADMIN_MODE_TARGET_ENV||"qa":""),
    NEXT_PUBLIC_ADMIN_MODE_DEPLOYMENT_ORIGIN:isolatedAdminBuild&&process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:"",
    NEXT_PUBLIC_ADMIN_MODE_BRANCH_ORIGIN:scorecardPreview?.branchOrigin||(isolatedAdminBuild&&process.env.VERCEL_BRANCH_URL?`https://${process.env.VERCEL_BRANCH_URL}`:""),
  },
  async headers() {
    return [{ source: "/sw.js", headers: [
      { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
      { key: "Service-Worker-Allowed", value: "/" },
    ] }];
  },
};

export default nextConfig;
