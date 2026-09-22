export const RETENTION_LIMITS = Object.freeze({ daily: 7, weekly: 4, monthly: 6 });

function verifiedPair(entry) {
  return entry && entry.verified === true && typeof entry.name === 'string' &&
    entry.checksumName === `${entry.name}.sha256` && Number.isFinite(Date.parse(entry.createdAt)) &&
    entry.packageId && entry.checksumId;
}

export function planRetention(entries, keep) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('INVALID_RETENTION_LIMIT');
  const valid = entries.filter(verifiedPair).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (valid.length <= 1) return { keep, valid: valid.length, candidates: [] };
  const candidates = valid.slice(keep).filter(candidate => valid.some(newer => Date.parse(newer.createdAt) > Date.parse(candidate.createdAt)));
  return { keep, valid: valid.length, candidates };
}
