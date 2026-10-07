export interface PilotTarget {
  status: string; candidate: boolean; isFlag: boolean; fieldVerifiedAt: string | null;
  coordinates: number[]; source: { provider: string };
}
export function mountPilot(root: HTMLElement, options: { target: PilotTarget; imageUrl: string }): () => void;
