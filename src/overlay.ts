import type { Point } from "./model";
export interface MappingOverlay {
  points: Point[];
  cursor?: Point;
  closed: boolean;
}
declare module "./model" {
  interface DesktopAPI {
    updateOverlay(overlay: MappingOverlay | null): void;
    getOverlay(): Promise<MappingOverlay | null>;
    onOverlay(callback: (overlay: MappingOverlay | null) => void): () => void;
  }
}
