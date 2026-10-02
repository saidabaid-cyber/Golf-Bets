import test from 'node:test';
import assert from 'node:assert/strict';
import {adminModeDatabaseIsolated} from '../lib/admin-mode';
import {previewDatabaseFeaturesAvailable,reviewedCourseDatabaseEnabled} from '../lib/preview-database';
import {isAdminPreviewOrigin} from '../lib/admin-preview-binding';
const qa={ADMIN_MODE_V2_ENABLED:'true',VERCEL:'1',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/admin-mode-v2',ADMIN_MODE_DB_REF:'abcdefghijklmnopqrst',NEXT_PUBLIC_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co'};
const dev={...qa,VERCEL_GIT_COMMIT_REF:'promotion/admin-v2-to-dev',ADMIN_MODE_TARGET_ENV:'dev',ADMIN_MODE_DB_REF:'bymeopxkxapfizeeqeyb',PREVIEW_DB_REF:'bymeopxkxapfizeeqeyb',NEXT_PUBLIC_SUPABASE_URL:'https://bymeopxkxapfizeeqeyb.supabase.co'};
test('same runtime supports explicitly bound QA and DEV without source changes',()=>{
 for(const env of [qa,dev,{...dev,VERCEL_GIT_COMMIT_REF:'integration/backyard-current'}]){
  assert.equal(adminModeDatabaseIsolated(env),true);assert.equal(previewDatabaseFeaturesAvailable(env),true);assert.equal(reviewedCourseDatabaseEnabled(env),true);
 }
 for(const patch of [{ADMIN_MODE_TARGET_ENV:'qa'},{ADMIN_MODE_TARGET_ENV:'production'},{PREVIEW_DB_REF:''},{ADMIN_MODE_V2_ENABLED:'false'},{ADMIN_MODE_DB_REF:'abcdefghijklmnopqrst'},{NEXT_PUBLIC_SUPABASE_URL:qa.NEXT_PUBLIC_SUPABASE_URL},{VERCEL_GIT_COMMIT_REF:'main'},{VERCEL_GIT_COMMIT_REF:'beta'},{VERCEL_GIT_COMMIT_REF:'feature/admin-mode-v2'},{VERCEL_ENV:'production'}])assert.equal(adminModeDatabaseIsolated({...dev,...patch}),false,JSON.stringify(patch));
 assert.equal(adminModeDatabaseIsolated({...qa,ADMIN_MODE_DB_REF:dev.ADMIN_MODE_DB_REF,NEXT_PUBLIC_SUPABASE_URL:dev.NEXT_PUBLIC_SUPABASE_URL}),false);
 assert.equal(previewDatabaseFeaturesAvailable({...dev,ADMIN_MODE_V2_ENABLED:'false'}),false,'promotion cannot fall back silently to DEV');
 assert.equal(reviewedCourseDatabaseEnabled({...dev,ADMIN_MODE_V2_ENABLED:'false'}),false);
});
test('browser binding limits DEV to its canonical origin and the exact promotion Preview',()=>{
 const binding={ref:dev.ADMIN_MODE_DB_REF,target:'dev',deploymentOrigin:'https://promotion-123.vercel.app',branchOrigin:'https://promotion-branch.vercel.app'};
 for(const origin of ['https://dev.thebackyard.com.mx',binding.deploymentOrigin,binding.branchOrigin])assert.equal(isAdminPreviewOrigin(origin,binding),true);
 for(const origin of ['https://app.thebackyard.com.mx','https://beta.thebackyard.com.mx','https://arbitrary.vercel.app','https://dev.thebackyard.com.mx.evil.invalid','https://dev.thebackyard.com.mx/?callback=evil'])assert.equal(isAdminPreviewOrigin(origin,binding),false);
 assert.equal(isAdminPreviewOrigin(binding.deploymentOrigin,{...binding,target:'qa'}),false);
 assert.equal(isAdminPreviewOrigin(binding.deploymentOrigin,{...binding,ref:'zhqmlpljloumldaczcfp'}),false);
});
