export type Point = { x: number; y: number };
export type Pattern = string;
export { PATTERNS } from "./patterns";
export interface Media {
  id: string;
  name: string;
  kind: "image" | "video";
  url: string;
  path?: string;
}
export interface Surface {
  id: string;
  name: string;
  corners: [Point, Point, Point, Point];
  source: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  color: string;
  speed?: number;
  detail?: number;
  /** Output-space outline; absent means a perspective-correct quad. */
  polygon?: Point[];
  kind?: "surface" | "mask";
  blendMode?: "normal" | "add" | "screen";
  edgeWidth?: number;
  feather?: number;
  /** Saved response settings; audio capture is always an explicit session action. */
  audio?: {
    enabled: boolean;
    band: "level" | "bass" | "mid" | "treble" | "beat";
    amount: number;
    mode: "brightness" | "zoom" | "both";
  };
  content?: {
    rotation: number;
    scale: number;
    offsetX: number;
    offsetY: number;
  };
}
export interface Project {
  version: 1 | 2;
  name: string;
  width: number;
  height: number;
  surfaces: Surface[];
  media: Media[];
  brightness: number;
  blackout: boolean;
  playing: boolean;
}
export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
  primary: boolean;
  internal: boolean;
}
export interface OutputStatus {
  open: boolean;
  displayId?: number;
  error?: string;
}
export interface DesktopAPI {
  getDisplays(): Promise<DisplayInfo[]>;
  onDisplays(callback: (displays: DisplayInfo[]) => void): () => void;
  openOutput(displayId: number): Promise<OutputStatus>;
  closeOutput(): Promise<void>;
  onOutputStatus(callback: (status: OutputStatus) => void): () => void;
  updateProject(project: Project): void;
  getProject(): Promise<Project | null>;
  onProject(callback: (project: Project) => void): () => void;
  importMedia(): Promise<Media[]>;
  saveProject(
    project: Project,
  ): Promise<{ saved: boolean; path?: string; error?: string }>;
  loadProject(): Promise<{
    project?: Project;
    error?: string;
    missing?: string[];
  }>;
  setBlackout(value: boolean): void;
}
declare global {
  interface Window {
    prism?: DesktopAPI;
  }
}
export function newSurface(index: number): Surface {
  const inset = 0.12 + Math.min(index, 8) * 0.025;
  return {
    id: crypto.randomUUID(),
    name: `Surface ${String(index + 1).padStart(2, "0")}`,
    corners: [
      { x: inset, y: inset },
      { x: 1 - inset, y: inset },
      { x: 1 - inset, y: 1 - inset },
      { x: inset, y: 1 - inset },
    ],
    source: "aurora",
    visible: true,
    locked: false,
    opacity: 1,
    color: "#a8f3cb",
  };
}
export function createProject(): Project {
  return {
    version: 2,
    name: "Untitled mapping",
    width: 1920,
    height: 1080,
    surfaces: [newSurface(0)],
    media: [],
    brightness: 0.65,
    blackout: false,
    playing: true,
  };
}
