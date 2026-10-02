import "server-only";
import type {NextRequest} from "next/server";
import {requireAdminMode} from "./admin-mode.server";
/** Every technical endpoint rechecks SUPER_ADMIN and the isolated target. */
export function advancedAdminRequest(request:NextRequest){return requireAdminMode(request,"advanced");}
