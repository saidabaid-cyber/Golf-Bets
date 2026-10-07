// Provider-independent local GPS/persistence helpers. No SDK and no network.
export const MAX_AGE_MS = 15000;
export const MAX_ACCURACY_METERS = 30;
const finite = v => typeof v === 'number' && Number.isFinite(v);
export function validCoordinate(p) {
  return Array.isArray(p) && p.length === 2 && p.every(finite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}
export function readingState(reading, now = Date.now()) {
  if (!reading || !validCoordinate(reading.wgs84) || !finite(reading.timestamp) || !finite(reading.accuracyMeters) || reading.accuracyMeters < 0) return 'UNAVAILABLE';
  if (reading.synthetic) return 'SIMULATED_NOT_OPERATIONAL';
  if (reading.timestamp > now + 1000) return 'INVALID_TIME';
  if (now - reading.timestamp > MAX_AGE_MS) return 'STALE';
  if (reading.accuracyMeters > MAX_ACCURACY_METERS) return 'LOW_ACCURACY';
  return 'LIVE_REPORTED'; // Reported accuracy is not a field calibration.
}
export const toYards = meters => { if (!finite(meters) || meters < 0) throw Error('INVALID_DISTANCE'); return meters / .9144; };
export function distanceMeters(a, b) {
  if (!validCoordinate(a) || !validCoordinate(b)) throw Error('INVALID_WGS84');
  if (a[0] === b[0] && a[1] === b[1]) return 0;
  // Vincenty inverse on the WGS84 ellipsoid. No elevation/plays-like adjustment.
  const major=6378137, f=1/298.257223563, minor=major*(1-f), rad=Math.PI/180;
  const u1=Math.atan((1-f)*Math.tan(a[1]*rad)), u2=Math.atan((1-f)*Math.tan(b[1]*rad));
  const s1=Math.sin(u1), c1=Math.cos(u1), s2=Math.sin(u2), c2=Math.cos(u2);
  const L=((b[0]-a[0]+540)%360-180)*rad;
  let lambda=L, sinSigma, cosSigma, sigma, sinAlpha, cos2Alpha, cos2SigmaM, converged=false;
  for(let i=0;i<200;i++) {
    const sl=Math.sin(lambda), cl=Math.cos(lambda);
    sinSigma=Math.hypot(c2*sl,c1*s2-s1*c2*cl);
    if(sinSigma===0) return 0;
    cosSigma=s1*s2+c1*c2*cl; sigma=Math.atan2(sinSigma,cosSigma);
    sinAlpha=c1*c2*sl/sinSigma; cos2Alpha=1-sinAlpha*sinAlpha;
    cos2SigmaM=cos2Alpha<1e-15?0:cosSigma-2*s1*s2/cos2Alpha;
    const C=f/16*cos2Alpha*(4+f*(4-3*cos2Alpha)), previous=lambda;
    lambda=L+(1-C)*f*sinAlpha*(sigma+C*sinSigma*(cos2SigmaM+C*cosSigma*(-1+2*cos2SigmaM*cos2SigmaM)));
    if(Math.abs(lambda-previous)<1e-12){converged=true;break;}
  }
  if(!converged) throw Error('GEODESIC_DID_NOT_CONVERGE'); // Never fabricate a fallback distance.
  const uSq=cos2Alpha*(major*major-minor*minor)/(minor*minor);
  const A=1+uSq/16384*(4096+uSq*(-768+uSq*(320-175*uSq)));
  const B=uSq/1024*(256+uSq*(-128+uSq*(74-47*uSq)));
  const delta=B*sinSigma*(cos2SigmaM+B/4*(cosSigma*(-1+2*cos2SigmaM**2)-B/6*cos2SigmaM*(-3+4*sinSigma**2)*(-3+4*cos2SigmaM**2)));
  return minor*A*(sigma-delta);
}
