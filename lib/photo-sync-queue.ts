import { readStoredJson } from "./round-utils";
import type { CloudDataBundle } from "./cloud-sync";

export const PHOTO_QUEUE_KEY = "backyard-photo-sync-queue-v1";
export type PhotoJob = { userId: string; roundId: string; photoId: string; operation: "upload" | "replace" | "delete"; status: "pending" | "uploading" | "failed"; revision: string };
type QueueStorage = Pick<Storage, "getItem" | "setItem">;
export function photoJobs(storage: QueueStorage) { return readStoredJson<PhotoJob[]>(storage, PHOTO_QUEUE_KEY, []); }

export function roundScorecardPhotoIds(round: { photoId?: unknown; scorecardPhotoIds?: unknown }) {
  return [...new Set([
    ...(typeof round.photoId === "string" ? [round.photoId] : []),
    ...(Array.isArray(round.scorecardPhotoIds) ? round.scorecardPhotoIds : []),
  ].filter((photoId): photoId is string => typeof photoId === "string" && Boolean(photoId.trim())))];
}

function enqueuePhotoJob(jobs: PhotoJob[], job: PhotoJob) {
  if (job.operation === "delete") {
    return [...jobs.filter(item => item.userId !== job.userId || item.roundId !== job.roundId), job];
  }
  if (job.operation === "replace") {
    return [...jobs.filter(item => item.userId !== job.userId || item.roundId !== job.roundId), job];
  }
  return [
    ...jobs.filter(item => item.userId !== job.userId
      || item.roundId !== job.roundId
      || item.operation === "replace"
      || (item.operation === "upload" && item.photoId !== job.photoId)),
    job,
  ];
}

/** Call only inside the account workspace after the explicit import decision. */
export function adoptGuestPhotoJobs(storage: QueueStorage, userId: string) {
  const adopted = photoJobs(storage)
    .map(job => job.userId === "guest" ? { ...job, userId, status: "pending" as const } : job)
    .reduce<PhotoJob[]>((jobs, job) => enqueuePhotoJob(jobs, job), []);
  storage.setItem(PHOTO_QUEUE_KEY, JSON.stringify(adopted));
}
export function queuePhoto(storage: QueueStorage, job: Omit<PhotoJob, "status">) {
  storage.setItem(PHOTO_QUEUE_KEY, JSON.stringify(enqueuePhotoJob(photoJobs(storage), { ...job, status: "pending" })));
}
function updateJob(storage: QueueStorage, job: PhotoJob, status?: PhotoJob["status"]) {
  storage.setItem(PHOTO_QUEUE_KEY, JSON.stringify(photoJobs(storage).flatMap(item => {
    if (item.userId !== job.userId || item.roundId !== job.roundId || item.photoId !== job.photoId || item.operation !== job.operation || item.revision !== job.revision) return [item];
    return status ? [{ ...item, status }] : [];
  })));
}
type PhotoTransport = { read: (photoId: string) => Promise<Blob | undefined>; upload: (roundId: string, photoId: string, blob: Blob) => Promise<boolean>; remove: (roundId: string) => Promise<boolean> };
export async function flushPhotoQueue(storage: QueueStorage, userId: string, cloud: CloudDataBundle, transport: PhotoTransport, current = () => true) {
  const deleted = new Set(cloud.tombstones.filter(item => item.entityType === "round").map(item => item.localId));
  const remotelyRemoved = new Set<string>();
  for (const job of photoJobs(storage).filter(item => item.userId === userId)) {
    if (!current()) throw new Error("Photo sync cancelled");
    updateJob(storage, job, "uploading");
    try {
      if (job.operation === "delete" || deleted.has(job.roundId)) {
        if (!remotelyRemoved.has(job.roundId)) {
          if (!await transport.remove(job.roundId)) throw new Error("Photo deletion not confirmed");
          remotelyRemoved.add(job.roundId);
        }
      } else {
        const round = cloud.history.find(item => item.id === job.roundId);
        if (!round) throw new Error("La ronda aún no se sincronizó; la foto sigue en este dispositivo.");
        if (job.operation === "replace" && !remotelyRemoved.has(job.roundId)) {
          if (!await transport.remove(job.roundId)) throw new Error("Photo replacement cleanup not confirmed");
          remotelyRemoved.add(job.roundId);
        }
        // Never overwrite a newer photo selected on a different device.
        const desiredPhotoIds = new Set(roundScorecardPhotoIds(round));
        if (desiredPhotoIds.has(job.photoId)) {
          const blob = await transport.read(job.photoId);
          if (!blob) throw new Error("La foto pendiente no está disponible en este dispositivo.");
          if (!current()) throw new Error("Photo sync cancelled");
          if (!await transport.upload(job.roundId, job.photoId, blob)) throw new Error("Photo upload not confirmed");
        }
      }
      if (!current()) throw new Error("Photo sync cancelled");
      updateJob(storage, job);
    } catch (error) { if (current()) updateJob(storage, job, "failed"); throw error; }
  }
}
