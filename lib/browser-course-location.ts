import type { CourseGeographicPoint } from './course-distance';

export type CourseLocationResult =
  | { status: 'located'; point: CourseGeographicPoint }
  | { status: 'denied' | 'unavailable' | 'timeout' | 'unsupported' };
export type CourseGeolocation = Pick<Geolocation, 'getCurrentPosition'>;

/** Device coordinates stay in memory. No storage, telemetry or network request.
 * The watchdog also covers browsers that never resolve a permission prompt.
 * Cancellation ignores late native callbacks; catalog/session refresh is unrelated. */
export function requestCourseLocation(
  geolocation: CourseGeolocation | undefined,
  onResult: (result: CourseLocationResult) => void,
  timers = { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (id: ReturnType<typeof setTimeout>) => clearTimeout(id) },
) {
  let settled = false;
  const timer: { id?: ReturnType<typeof setTimeout> } = {};
  const finish = (result: CourseLocationResult) => {
    if (settled) return;
    settled = true;
    if (timer.id !== undefined) timers.clear(timer.id);
    onResult(result);
  };
  const cancel = () => { settled = true; if (timer.id !== undefined) timers.clear(timer.id); };
  if (!geolocation) { finish({ status: 'unsupported' }); return cancel; }
  timer.id = timers.set(() => finish({ status: 'timeout' }), 15000);
  try {
    geolocation.getCurrentPosition(({ coords }) => {
      const point = { latitude: coords.latitude, longitude: coords.longitude };
      if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) {
        finish({ status: 'unavailable' }); return;
      }
      finish({ status: 'located', point });
    }, error => finish({ status: error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable' }),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  } catch { finish({ status: 'unavailable' }); }
  return cancel;
}
