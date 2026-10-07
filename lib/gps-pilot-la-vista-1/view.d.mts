export interface PilotTarget {
  status: string; candidate: boolean; isFlag: boolean; fieldVerifiedAt: string | null;
  coordinates: number[]; source: { provider: string };
}
export interface PilotImageReference {
  width: number; height: number; pixelCenterNW: number[]; pixelSizeMeters: number[];
  projection: string; status: string; fieldVerifiedAt: string | null;
}
export function mountPilot(root: HTMLElement, options: { target: PilotTarget; imageUrl: string; imageReference: PilotImageReference }): () => void;
