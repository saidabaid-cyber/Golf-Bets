import { GolfApiFileStore, documentedRequest } from '../lib/golfapi/controlled-store.mjs';

// Explicit, single-operation operator command. No loop, polling or automatic
// retry; no call occurs on imports, builds, tests or normal application reads.
export async function runGolfApiCommand(args, env = process.env) {
  const [operation, endpoint, parametersJson = '{}', reason] = args;
  const store = new GolfApiFileStore(env.GOLFAPI_STORE_PATH);
  if (operation === 'init') { const ledger = await store.initialize(); return { initialized: true, stageId: ledger.stageId, used: ledger.attempts.length, maximum: ledger.requestLimit }; }
  if (operation === 'status') {
    const ledger = await store.ledger();
    return { stageId: ledger.stageId, used: ledger.attempts.length, remaining: ledger.requestLimit - ledger.attempts.length, halted: ledger.halted, requests: ledger.attempts.map(row => ({ sequence: row.sequence, endpoint: row.endpoint, parameters: row.parameters, reason: row.reason, httpStatus: row.httpStatus, providerRequestsLeft: row.providerRequestsLeft, state: row.state })) };
  }
  if (operation !== 'get') throw Error('GOLFAPI_COMMAND_INVALID');
  const request = documentedRequest(endpoint, JSON.parse(parametersJson));
  const result = await store.request(request, { apiKey: env.GOLFAPI_API_KEY, reason, networkEnabled: env.GOLFAPI_NETWORK_ENABLED === 'true' });
  const body = JSON.parse(result.response.bodyText);
  const ledger = await store.ledger();
  return { cached: result.cached, httpStatus: result.response.httpStatus, used: ledger.attempts.length, remaining: 10 - ledger.attempts.length, providerRequestsLeft: body.apiRequestsLeft ?? null, numClubs: body.numClubs ?? null, numCoordinates: body.numCoordinates ?? null, responseKey: request.requestKey, halted: ledger.halted };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/golfapi-ingest.mjs')) {
  try { console.log(JSON.stringify(await runGolfApiCommand(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message?.startsWith('GOLFAPI_') ? error.message : 'GOLFAPI_COMMAND_FAILED_NO_RETRY'); process.exitCode = 1; }
}
