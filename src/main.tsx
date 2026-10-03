import { version as APP_VERSION } from "../package.json";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  Plus,
  AudioLines,
  Play,
  Pause,
  Monitor,
  ChevronDown,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  UnlockKeyhole,
  Copy,
  Trash2,
  Upload,
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  Maximize,
  Move,
  Crosshair,
  X,
  Image,
  Film,
  Keyboard,
  HelpCircle,
  Sun,
  Layers,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  Circle,
  SlidersHorizontal,
  Shuffle,
  Search,
  MousePointer2,
  PenTool,
  Square,
  Triangle,
  ScanLine,
  Magnet,
  Focus,
  GripVertical,
  Scissors,
} from "lucide-react";
import {
  createProject,
  newSurface,
  PATTERNS,
  type Project,
  type Surface,
  type DisplayInfo,
  type OutputStatus,
  type Point,
} from "./model";
import { ProjectionRenderer } from "./renderer";
import { AudioPanel } from "./AudioPanel";
import { publishAudioFrame } from "./audio";
import {
  CATALOG,
  ANIMATIONS,
  CATEGORIES,
  patternNames,
  patternById,
} from "./patterns";
import {
  surfacePoints,
  validatePolygon,
  pointInPolygon,
  moveSurfacePoint,
  translateSurface,
  insertSurfacePoint,
  removeSurfacePoint,
  createShapeSurface,
} from "./polygon";
import type { MappingOverlay } from "./overlay";
import { validateBrowserProject } from "./project-validation";
import { readBootProject } from "./persistence";
import { projectFileName, saveFile } from "./platform";
import { usePersistence } from "./usePersistence";
import { DeviceSection } from "./DeviceSection";
import "./style.css";
import "./pwa.css";

const api = window.prism;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const corners = ["Top left", "Top right", "Bottom right", "Bottom left"];
function safeDraft(): Project {
  // Browsers rebuild draft media from IndexedDB; the desktop app still starts clean.
  return readBootProject({ keepMedia: !api });
}
function useRenderer(
  canvas: React.RefObject<HTMLCanvasElement | null>,
  project: Project,
  onError: (message: string) => void,
) {
  const current = useRef(project);
  current.current = project;
  const [fps, setFps] = useState(0);
  useEffect(() => {
    if (!canvas.current) return;
    let renderer: ProjectionRenderer;
    let frame = 0;
    let count = 0;
    let last = performance.now();
    let elapsed = 0;
    let previous = last;
    try {
      renderer = new ProjectionRenderer(canvas.current, { onError });
    } catch (error) {
      onError(String(error));
      return;
    }
    const loop = (now: number) => {
      elapsed += current.current.playing ? (now - previous) / 1000 : 0;
      previous = now;
      renderer.render(current.current, elapsed);
      count++;
      if (now - last > 1000) {
        setFps(Math.round((count * 1000) / (now - last)));
        count = 0;
        last = now;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      renderer.destroy();
    };
  }, [canvas, onError]);
  return fps;
}
function Output() {
  const [overlay, setOverlay] = useState<MappingOverlay | null>(null);
  const [outputSize, setOutputSize] = useState({ width: 0, height: 0 });
  const [project, setProject] = useState<Project>({
    ...createProject(),
    surfaces: [],
    blackout: true,
  });
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const fail = useCallback((m: string) => setError(m), []);
  useRenderer(canvas, project, fail);
  useEffect(() => {
    api?.getAudio().then(publishAudioFrame);
    return api?.onAudio(publishAudioFrame);
  }, []);
  useEffect(() => {
    api?.getOverlay().then(setOverlay);
    return api?.onOverlay(setOverlay);
  }, []);
  useEffect(() => {
    api?.getProject().then((p) => p && setProject(p));
    return api?.onProject(setProject);
  }, []);
  useEffect(() => {
    const resize = () => {
      if (canvas.current) {
        const width = Math.min(
          innerWidth,
          (innerHeight * project.width) / project.height,
        );
        const height = (width * project.height) / project.width;
        setOutputSize({ width, height });
        canvas.current.width = Math.round(width * devicePixelRatio);
        canvas.current.height = Math.round(height * devicePixelRatio);
        canvas.current.style.width = `${width}px`;
        canvas.current.style.height = `${height}px`;
      }
    };
    resize();
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, [project.width, project.height]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") api?.closeOutput();
      if (e.key.toLowerCase() === "b") api?.setBlackout(!project.blackout);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [project.blackout]);
  return (
    <div className="projector">
      <canvas ref={canvas} />
      {overlay && !project.blackout && (
        <svg
          className="projector-guides"
          width={outputSize.width}
          height={outputSize.height}
          viewBox={`0 0 ${project.width} ${project.height}`}
        >
          {overlay.closed ? (
            <polygon
              points={overlay.points
                .map((p) => `${p.x * project.width},${p.y * project.height}`)
                .join(" ")}
            />
          ) : (
            <polyline
              points={[
                ...overlay.points,
                ...(overlay.cursor ? [overlay.cursor] : []),
              ]
                .map((p) => `${p.x * project.width},${p.y * project.height}`)
                .join(" ")}
            />
          )}
          {overlay.points.map((p, i) => (
            <g key={i}>
              <circle
                cx={p.x * project.width}
                cy={p.y * project.height}
                r={i === 0 ? 9 : 6}
              />
              <text x={p.x * project.width + 14} y={p.y * project.height - 12}>
                {i + 1}
              </text>
            </g>
          ))}
        </svg>
      )}
      {error && <div className="output-error">Output unavailable: {error}</div>}
    </div>
  );
}
function App() {
  const [project, setProject] = useState<Project>(safeDraft);
  const [selected, setSelected] = useState(project.surfaces[0]?.id || "");
  const [corner, setCorner] = useState(0);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [displayId, setDisplayId] = useState<number>();
  const [output, setOutput] = useState<OutputStatus>({ open: false });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [help, setHelp] = useState(false);
  const [tab, setTab] = useState<"patterns" | "media">("patterns");
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [mix, setMix] = useState(false);
  const [tool, setTool] = useState<"select" | "polygon" | "mask">("select");
  const [draft, setDraft] = useState<Point[]>([]);
  const [draftCursor, setDraftCursor] = useState<Point | null>(null);
  const [guides, setGuides] = useState(false);
  const [snap, setSnap] = useState(true);
  const [solo, setSolo] = useState<string | null>(null);
  const layerDrag = useRef<string | null>(null);
  const [history, setHistory] = useState<{
    past: Project[];
    future: Project[];
  }>({ past: [], future: [] });
  const [saving, setSaving] = useState(false);
  const [busyOutput, setBusyOutput] = useState(false);
  const [audioFocus, setAudioFocus] = useState(false);
  const [outputSettings, setOutputSettings] = useState(true);
  const [previewSize, setPreviewSize] = useState({ width: 960, height: 540 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvasArea = useRef<HTMLDivElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const current = useRef(project);
  current.current = project;
  const drag = useRef<{
    point: number | null;
    start: { x: number; y: number };
    surface: Surface;
    project: Project;
  } | null>(null);
  const surface = project.surfaces.find((s) => s.id === selected);
  const selectedPoints = surface ? surfacePoints(surface) : [];
  const renderProject: Project = solo
    ? {
        ...project,
        surfaces: project.surfaces.map((s) => ({
          ...s,
          visible: s.visible && (s.id === solo || s.kind === "mask"),
        })),
      }
    : project;
  const material = surface ? patternById.get(surface.source) : undefined;
  const visiblePatterns = CATALOG.filter(
    (p) =>
      (category === "All" || p.category === category) &&
      `${p.label} ${p.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const fail = useCallback((m: string) => setError(m), []);
  const fps = useRenderer(canvas, renderProject, fail);
  const message = (m: string) => setNotice(m);
  const commit = useCallback((next: Project) => {
    setHistory((h) => ({
      past: [...h.past, clone(current.current)].slice(-60),
      future: [],
    }));
    setProject(next);
  }, []);
  useEffect(() => {
    setCorner((c) => Math.min(c, Math.max(0, selectedPoints.length - 1)));
  }, [selected, selectedPoints.length]);
  useEffect(() => {
    if (solo && !project.surfaces.some((s) => s.id === solo)) setSolo(null);
  }, [solo, project.surfaces]);
  useEffect(() => {
    const overlay: MappingOverlay | null =
      tool !== "select" && draft.length
        ? {
            points: draft,
            closed: false,
            ...(draftCursor ? { cursor: draftCursor } : {}),
          }
        : guides && surface?.visible
          ? { points: selectedPoints, closed: true }
          : null;
    api?.updateOverlay(overlay);
  }, [tool, draft, draftCursor, guides, surface]);
  const update = (patch: Partial<Project>) => commit({ ...project, ...patch });
  const updateSurface = (patch: Partial<Surface>) => {
    if (!surface) return;
    commit({
      ...project,
      surfaces: project.surfaces.map((s) =>
        s.id === selected ? { ...s, ...patch } : s,
      ),
    });
  };
  const choosePattern = (source: string) => {
    if (surface?.kind === "mask") {
      message(
        "Cutout masks block light. Select an animation layer to change its source.",
      );
      return;
    }
    setMix(false);
    updateSurface({ source });
  };
  const shufflePattern = () => {
    const candidates = ANIMATIONS.filter((p) => p.id !== surface?.source);
    if (candidates.length)
      choosePattern(
        candidates[Math.floor(Math.random() * candidates.length)].id,
      );
  };
  useEffect(() => {
    if (!mix || !project.playing || !selected || surface?.kind === "mask")
      return;
    const timer = setInterval(
      () =>
        setProject((previous) => ({
          ...previous,
          surfaces: previous.surfaces.map((s) => {
            if (s.id !== selected) return s;
            const index = ANIMATIONS.findIndex((p) => p.id === s.source);
            return {
              ...s,
              source: ANIMATIONS[(index + 1) % ANIMATIONS.length].id,
            };
          }),
        })),
      20000,
    );
    return () => clearInterval(timer);
  }, [mix, project.playing, selected]);
  useEffect(() => setMix(false), [selected]);
  const undo = useCallback(
    () =>
      setHistory((h) => {
        if (!h.past.length) return h;
        const previous = h.past.at(-1)!;
        setProject(clone(previous));
        return {
          past: h.past.slice(0, -1),
          future: [clone(current.current), ...h.future],
        };
      }),
    [],
  );
  const redo = useCallback(
    () =>
      setHistory((h) => {
        if (!h.future.length) return h;
        setProject(clone(h.future[0]));
        return {
          past: [...h.past, clone(current.current)],
          future: h.future.slice(1),
        };
      }),
    [],
  );
  const device = usePersistence({
    project,
    setProject,
    notify: message,
    fail,
  });
  useEffect(() => {
    api?.updateProject(renderProject);
    device.saveDraft(project);
  }, [project, solo]);
  useEffect(() => {
    if (!project.surfaces.some((s) => s.id === selected))
      setSelected(project.surfaces.at(-1)?.id || "");
  }, [project.surfaces, selected]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!api) return;
    const handle = (list: DisplayInfo[]) => {
      setDisplays(list);
      setDisplayId((id) =>
        list.some((d) => d.id === id)
          ? id
          : (
              list.find((d) => !d.internal && !d.primary) ||
              list.find((d) => !d.primary) ||
              list[0]
            )?.id,
      );
    };
    api
      .getDisplays()
      .then(handle)
      .catch((e) => setError(String(e)));
    const off = api.onDisplays(handle),
      off2 = api.onOutputStatus(setOutput),
      off3 = api.onProject((incoming) =>
        setProject((p) => ({ ...p, blackout: incoming.blackout })),
      );
    return () => {
      off();
      off2();
      off3();
    };
  }, []);
  useEffect(() => {
    if (!canvasArea.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const ratio = project.width / project.height;
      const width = Math.max(
        1,
        Math.floor(
          Math.min(
            entry.contentRect.width,
            (entry.contentRect.height - 67) * ratio,
          ),
        ),
      );
      setPreviewSize({ width, height: Math.max(1, Math.round(width / ratio)) });
    });
    observer.observe(canvasArea.current);
    return () => observer.disconnect();
  }, [project.width, project.height]);
  const blackout = () => setProject((p) => ({ ...p, blackout: !p.blackout }));
  const cancelDrawing = () => {
    setDraft([]);
    setDraftCursor(null);
    setTool("select");
  };
  const startDrawing = (next: "polygon" | "mask") => {
    setMix(false);
    setDraft([]);
    setDraftCursor(null);
    setTool(next);
  };
  const finishDrawing = () => {
    const validity = validatePolygon(draft);
    if (!validity.valid) {
      message(
        validity.reason ||
          "Place at least three points before closing the outline.",
      );
      return;
    }
    if (project.surfaces.length >= 32) {
      message("This version supports up to 32 layers.");
      return;
    }
    const next = createShapeSurface(
      "polygon",
      project.surfaces.length,
      draft,
      project.width / project.height,
    );
    next.kind = tool === "mask" ? "mask" : "surface";
    next.source = tool === "mask" ? "solid" : "edge-chase";
    next.name =
      tool === "mask"
        ? `Cutout ${project.surfaces.length + 1}`
        : `Outline ${project.surfaces.length + 1}`;
    if (tool === "mask") next.color = "#000000";
    commit({ ...project, surfaces: [...project.surfaces, next] });
    setSelected(next.id);
    setCorner(0);
    cancelDrawing();
    message(
      tool === "mask"
        ? "Cutout added. It darkens layers below it."
        : "Outline closed. Choose an animation for this layer.",
    );
  };
  const addPreset = (
    preset: "rectangle" | "square" | "triangle" | "circle",
  ) => {
    if (project.surfaces.length >= 32) {
      message("This version supports up to 32 layers.");
      return;
    }
    const next = createShapeSurface(
      preset,
      project.surfaces.length,
      undefined,
      project.width / project.height,
    );
    next.source =
      preset === "triangle"
        ? "triangle-weave"
        : preset === "circle"
          ? "radar"
          : "edge-chase";
    commit({ ...project, surfaces: [...project.surfaces, next] });
    setSelected(next.id);
    setCorner(0);
    cancelDrawing();
  };
  const addSurface = () => addPreset("rectangle");
  const duplicate = () => {
    if (!surface || project.surfaces.length >= 32) return;
    const next = {
      ...translateSurface(clone(surface), { x: 0.025, y: 0.025 }),
      id: crypto.randomUUID(),
      name: surface.name + " copy",
      locked: false,
    };
    commit({ ...project, surfaces: [...project.surfaces, next] });
    setSelected(next.id);
  };
  const remove = () => {
    if (!surface || surface.locked) return;
    commit({
      ...project,
      surfaces: project.surfaces.filter((s) => s.id !== selected),
    });
  };
  const toggleOutput = async () => {
    if (!api) {
      message("Launch the desktop app to send output to a projector.");
      return;
    }
    setBusyOutput(true);
    try {
      if (output.open) await api.closeOutput();
      else if (displayId !== undefined) {
        const result = await api.openOutput(displayId);
        setOutput(result);
        if (result.error) setError(result.error);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyOutput(false);
    }
  };
  const importBrowserFiles = (files: File[]) => {
    const media = device.importFiles(files);
    if (!media.length) return;
    commit({ ...project, media: [...project.media, ...media] });
    setTab("media");
  };
  const importMedia = async () => {
    if (!api) {
      mediaInput.current?.click();
      return;
    }
    try {
      const media = await api.importMedia();
      if (media.length) {
        commit({ ...project, media: [...project.media, ...media] });
        setTab("media");
        message(
          `${media.length} media file${media.length === 1 ? "" : "s"} added. Select one to assign it.`,
        );
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      if (api) {
        const result = await api.saveProject(project);
        if (result.error) setError(result.error);
        else if (result.saved)
          message(
            "Project saved. Media files stay in their original locations.",
          );
      } else {
        const portable = {
          ...project,
          media: project.media.map(({ url, ...m }) => ({ ...m, url: "" })),
        };
        const outcome = await saveFile(
          projectFileName(project.name),
          JSON.stringify(portable, null, 2),
          "application/json",
        );
        if (outcome !== "cancelled")
          message(
            project.media.length
              ? "Saved geometry. Browser media must be reimported after opening."
              : "Project saved.",
          );
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };
  const open = async () => {
    setMix(false);
    setSolo(null);
    cancelDrawing();
    if (!api) {
      projectInput.current?.click();
      return;
    }
    try {
      const result = await api.loadProject();
      if (result.error) setError(result.error);
      else if (result.project) {
        commit(result.project);
        setSelected(result.project.surfaces[0]?.id || "");
        message(
          result.missing?.length
            ? `Opened. Relink missing media by importing: ${result.missing.join(", ")}`
            : "Project opened.",
        );
      }
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (help) {
        if (e.key === "Escape") setHelp(false);
        if (e.key === "Tab") {
          const buttons = Array.from(
            document.querySelectorAll<HTMLButtonElement>(".help-modal button"),
          );
          const first = buttons[0],
            last = buttons.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
        return;
      }
      if ((e.target as HTMLElement).matches("input,textarea,select")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (tool !== "select") {
          setDraft((p) => p.slice(0, -1));
          return;
        }
        e.shiftKey ? redo() : undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        blackout();
      }
      if (e.code === "Space") {
        e.preventDefault();
        setProject((p) => ({ ...p, playing: !p.playing }));
      }
      if (tool !== "select") {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelDrawing();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          finishDrawing();
          return;
        }
        if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault();
          setDraft((points) => points.slice(0, -1));
          return;
        }
      }
      if (e.key.toLowerCase() === "p") {
        startDrawing("polygon");
        return;
      }
      if (e.key.toLowerCase() === "v") {
        cancelDrawing();
        return;
      }
      if (e.key.toLowerCase() === "g") {
        setGuides((g) => !g);
        return;
      }
      if (e.key === "Escape" && output.open) void api?.closeOutput();
      if (/^[1-9]$/.test(e.key))
        setCorner(Math.min(selectedPoints.length - 1, Number(e.key) - 1));
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      }
      if (e.key.startsWith("Arrow") && surface && !surface.locked) {
        e.preventDefault();
        const amount = e.shiftKey ? 10 : 1;
        const p = selectedPoints[corner];
        if (!p) return;
        const next = moveSurfacePoint(surface, corner, {
          x:
            p.x +
            (e.key === "ArrowRight"
              ? amount
              : e.key === "ArrowLeft"
                ? -amount
                : 0) /
              project.width,
          y:
            p.y +
            (e.key === "ArrowDown"
              ? amount
              : e.key === "ArrowUp"
                ? -amount
                : 0) /
              project.height,
        });
        updateSurface(next);
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });
  const getPoint = (e: {
    clientX: number;
    clientY: number;
    shiftKey?: boolean;
  }): Point => {
    const rect = stage.current!.getBoundingClientRect();
    let p = {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
    if (e.shiftKey && tool !== "select" && draft.length) {
      const last = draft.at(-1)!;
      const dx = (p.x - last.x) * rect.width,
        dy = (p.y - last.y) * rect.height;
      const angle =
        (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
      const r = Math.hypot(dx, dy);
      p = {
        x: Math.max(
          0,
          Math.min(1, last.x + (Math.cos(angle) * r) / rect.width),
        ),
        y: Math.max(
          0,
          Math.min(1, last.y + (Math.sin(angle) * r) / rect.height),
        ),
      };
    }
    if (snap) {
      const targets = project.surfaces
        .filter((s) => s.id !== selected || tool !== "select")
        .flatMap(surfacePoints);
      targets.push(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      );
      const nearest = targets
        .map((q) => ({
          q,
          d: Math.hypot((q.x - p.x) * rect.width, (q.y - p.y) * rect.height),
        }))
        .filter((v) => v.d < 8)
        .sort((a, b) => a.d - b.d)[0];
      if (nearest) p = { ...nearest.q };
    }
    return p;
  };
  const nearestOutlineEdge = (p: Point) => {
    if (!surface?.polygon) return null;
    const rect = stage.current!.getBoundingClientRect();
    let closest: { edge: number; point: Point; distance: number } | null = null;
    selectedPoints.forEach((a, i) => {
      const b = selectedPoints[(i + 1) % selectedPoints.length];
      const dx = (b.x - a.x) * rect.width,
        dy = (b.y - a.y) * rect.height;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p.x - a.x) * rect.width * dx + (p.y - a.y) * rect.height * dy) /
            (dx * dx + dy * dy),
        ),
      );
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const distance = Math.hypot(
        (p.x - q.x) * rect.width,
        (p.y - q.y) * rect.height,
      );
      if (!closest || distance < closest.distance)
        closest = { edge: i, point: q, distance };
    });
    return closest as { edge: number; point: Point; distance: number } | null;
  };
  const stagePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = getPoint(e);
    if (tool !== "select") {
      e.preventDefault();
      const rect = stage.current!.getBoundingClientRect();
      if (
        draft.length >= 3 &&
        Math.hypot(
          (p.x - draft[0].x) * rect.width,
          (p.y - draft[0].y) * rect.height,
        ) < 14
      ) {
        finishDrawing();
        return;
      }
      if (draft.length >= 64) {
        message(
          "Use up to 64 points per outline. Click the first point to finish.",
        );
        return;
      }
      if (draft.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.0001)) {
        message("Place the next point in a different position.");
        return;
      }
      setDraft((points) => [...points, p]);
      setDraftCursor(p);
      return;
    }
    // Keep a selected outline active within its edge hit area, including the
    // few pixels outside the fill. This lets double-click insert a point on a
    // sloped edge without the first click selecting a layer underneath.
    const edge = nearestOutlineEdge(p);
    if (
      surface?.visible &&
      !surface.locked &&
      (!solo || solo === surface.id) &&
      edge &&
      edge.distance < 14
    ) {
      beginDrag(e, null, surface.id);
      return;
    }
    const hit = [...project.surfaces]
      .reverse()
      .find(
        (s) =>
          s.visible &&
          (!solo || s.id === solo || s.kind === "mask") &&
          pointInPolygon(p, surfacePoints(s)),
      );
    if (hit) beginDrag(e, null, hit.id);
  };
  const beginDrag = (
    e: React.PointerEvent,
    point: number | null,
    id = selected,
  ) => {
    if (tool !== "select") return;
    const s = project.surfaces.find((s) => s.id === id);
    if (!s) return;
    setSelected(id);
    if (s.locked) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (point !== null) setCorner(point);
    drag.current = {
      point,
      start: getPoint(e),
      surface: clone(s),
      project: clone(project),
    };
  };
  const onMove = (e: React.PointerEvent) => {
    if (tool !== "select") {
      setDraftCursor(getPoint(e));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const p = getPoint(e);
    setProject((current) => ({
      ...current,
      surfaces: current.surfaces.map((s) =>
        s.id === d.surface.id
          ? d.point === null
            ? translateSurface(d.surface, {
                x: p.x - d.start.x,
                y: p.y - d.start.y,
              })
            : moveSurfacePoint(s, d.point, p)
          : s,
      ),
    }));
  };
  const insertPoint = (e: React.MouseEvent) => {
    if (tool !== "select" || !surface?.polygon || surface.locked) return;
    const match = nearestOutlineEdge(getPoint(e));
    if (match && match.distance < 14) {
      const next = insertSurfacePoint(surface, match.edge, match.point);
      if (next !== surface) {
        updateSurface(next);
        setCorner(match.edge + 1);
        message("Point added. Drag it to refine the outline.");
      }
    }
  };
  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (JSON.stringify(d.project) !== JSON.stringify(current.current))
      setHistory((h) => ({
        past: [...h.past, d.project].slice(-60),
        future: [],
      }));
  };
  const point = selectedPoints[corner];
  const display = displays.find((d) => d.id === displayId);
  const moveLayer = (direction: number) => {
    const index = project.surfaces.findIndex((s) => s.id === selected);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= project.surfaces.length) return;
    const items = [...project.surfaces];
    [items[index], items[next]] = [items[next], items[index]];
    update({ surfaces: items });
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M16 3 30 27H2Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="m16 3 4 24M2 27l17-10 11 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          <span>
            prism<span className="brand-light">mapper</span>
          </span>
          <span className="alpha">EARLY ACCESS · {APP_VERSION}</span>
        </div>
        <div className="header-actions">
          <button onClick={open}>
            <FolderOpen size={15} />
            Open
          </button>
          <button onClick={save} disabled={saving}>
            <Save size={15} />
            {saving ? "Saving…" : "Save project"}
          </button>
          <span className="separator" />
          <button
            className="icon-button"
            title="Quick start & shortcuts"
            aria-label="Quick start and shortcuts"
            onClick={() => setHelp(true)}
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </header>
      <div className="workspace-bar">
        <div className="project-title">
          <span className="status-dot" />
          <input
            aria-label="Project name"
            maxLength={80}
            value={project.name}
            onChange={(e) => setProject({ ...project, name: e.target.value })}
          />
          <span className="project-tag">INDOOR SESSION</span>
        </div>
        <div className="session-meta">
          <span>LOCAL WORKSPACE</span>
          <span>Free & open source</span>
        </div>
      </div>
      <main className="workspace">
        <aside className="left-panel">
          <div className="panel-heading">
            <h2>
              <Layers size={15} />
              Layers <span className="count">{project.surfaces.length}</span>
            </h2>
            <button
              className="icon-button"
              onClick={addSurface}
              aria-label="Add surface"
              title="Add surface"
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="surface-list">
            {[...project.surfaces].reverse().map((s, i) => (
              <div
                className={`surface-row ${selected === s.id ? "selected" : ""}`}
                key={s.id}
                draggable
                onDragStart={() => {
                  layerDrag.current = s.id;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = layerDrag.current;
                  layerDrag.current = null;
                  if (!id || id === s.id) return;
                  const moving = project.surfaces.find((x) => x.id === id);
                  if (!moving) return;
                  const reordered = project.surfaces.filter((x) => x.id !== id);
                  reordered.splice(
                    reordered.findIndex((x) => x.id === s.id) + 1,
                    0,
                    moving,
                  );
                  update({ surfaces: reordered });
                }}
              >
                <button
                  className="surface-select"
                  onClick={() => setSelected(s.id)}
                >
                  <span
                    className={`surface-glyph ${s.kind === "mask" ? "mask-glyph" : ""}`}
                  >
                    <svg viewBox="0 0 32 26">
                      <path d="M5 5 27 3 26 22 5 20Z" />
                    </svg>
                  </span>
                  <span>
                    <strong>{s.name}</strong>
                    <small>
                      {s.kind === "mask"
                        ? "CUTOUT MASK"
                        : patternNames[s.source] ||
                          project.media.find((m) => m.id === s.source)?.name ||
                          "Missing media"}
                    </small>
                  </span>
                </button>
                <button
                  className="icon-button subtle"
                  aria-label={`${s.visible ? "Hide" : "Show"} ${s.name}`}
                  onClick={() =>
                    commit({
                      ...project,
                      surfaces: project.surfaces.map((x) =>
                        x.id === s.id ? { ...x, visible: !x.visible } : x,
                      ),
                    })
                  }
                >
                  {s.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <div className="layer-mini-tools">
                  <button
                    className={`icon-button ${solo === s.id ? "active" : ""}`}
                    aria-label={`${solo === s.id ? "Unsolo" : "Solo"} ${s.name}`}
                    title="Solo layer"
                    onClick={() => setSolo(solo === s.id ? null : s.id)}
                  >
                    <Focus size={12} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`${s.locked ? "Unlock" : "Lock"} ${s.name}`}
                    onClick={() =>
                      commit({
                        ...project,
                        surfaces: project.surfaces.map((x) =>
                          x.id === s.id ? { ...x, locked: !x.locked } : x,
                        ),
                      })
                    }
                  >
                    {s.locked ? (
                      <LockKeyhole size={12} />
                    ) : (
                      <UnlockKeyhole size={12} />
                    )}
                  </button>
                </div>
              </div>
            ))}
            {!project.surfaces.length && (
              <div className="empty">
                Your canvas is ready.
                <br />
                Add a surface to begin.
              </div>
            )}
          </div>
          <div className="layer-add-row">
            <button className="add-surface" onClick={addSurface}>
              <Plus size={14} />
              Rectangle
            </button>
            <button
              className="add-surface"
              onClick={() => startDrawing("polygon")}
            >
              <PenTool size={14} />
              Draw outline
            </button>
          </div>
          <p className="layer-order-note">
            Top layer appears in front · drag to reorder
          </p>
          <div className="library">
            <div className="panel-heading">
              <h2>Source library</h2>
              <button
                className="icon-button"
                onClick={importMedia}
                aria-label="Import media"
                title="Import image or video"
              >
                <Upload size={15} />
              </button>
            </div>
            <div className="tabs">
              <button
                className={tab === "patterns" ? "active" : ""}
                onClick={() => setTab("patterns")}
              >
                Generators
              </button>
              <button
                className={tab === "media" ? "active" : ""}
                onClick={() => setTab("media")}
              >
                My media <span>{project.media.length || ""}</span>
              </button>
            </div>
            {tab === "patterns" ? (
              <div className="generator-browser">
                <div className="generator-intro">
                  <span>{ANIMATIONS.length} animations · 3 tools</span>
                  <button
                    className="icon-button"
                    title="Shuffle animation"
                    aria-label="Shuffle animation"
                    disabled={!surface || surface.kind === "mask"}
                    onClick={shufflePattern}
                  >
                    <Shuffle size={14} />
                  </button>
                </div>
                <label className="generator-search">
                  <Search size={13} />
                  <input
                    aria-label="Search animations"
                    placeholder="Find a look…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      className="icon-button"
                      aria-label="Clear animation search"
                      onClick={() => setSearch("")}
                    >
                      <X size={12} />
                    </button>
                  )}
                </label>
                <div className="generator-filters">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c}
                      className={category === c ? "active" : ""}
                      aria-pressed={category === c}
                      onClick={() => setCategory(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className="mix-control">
                  <button
                    disabled={!surface || surface.kind === "mask"}
                    className={mix ? "active" : ""}
                    onClick={() => setMix(!mix)}
                    aria-label={
                      mix ? "Stop animation mix" : "Start animation mix"
                    }
                  >
                    {mix ? <Pause size={12} /> : <Play size={12} />}{" "}
                    {mix ? "Mix running" : "Play a mix"}
                  </button>
                  <span>Changes every 20s</span>
                </div>
                <div className="pattern-library">
                  {visiblePatterns.map((p) => (
                    <button
                      key={p.id}
                      className={`pattern-card ${surface?.source === p.id ? "active" : ""}`}
                      aria-label={p.label}
                      aria-pressed={surface?.source === p.id}
                      title={p.description}
                      disabled={!surface || surface.kind === "mask"}
                      onClick={() => choosePattern(p.id)}
                    >
                      <span className={`pattern-art ${p.id}`}>
                        <img
                          src={`./previews/${p.id}.png`}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                        {p.animated && (
                          <span className="animated-badge">
                            <Play size={8} />
                          </span>
                        )}
                      </span>
                      <span>
                        {p.label}
                        {surface?.source === p.id && <Check size={12} />}
                      </span>
                    </button>
                  ))}
                </div>
                {!visiblePatterns.length && (
                  <p className="empty">
                    No matching animations. Try another search or category.
                  </p>
                )}
              </div>
            ) : (
              <div className="media-library">
                {project.media.map((m) => (
                  <button
                    className={`media-row ${surface?.source === m.id ? "active" : ""}`}
                    disabled={!surface || surface.kind === "mask"}
                    key={m.id}
                    onClick={() => choosePattern(m.id)}
                  >
                    {m.kind === "image" ? (
                      <Image size={18} />
                    ) : (
                      <Film size={18} />
                    )}
                    <span>{m.name}</span>
                    {surface?.source === m.id && <Check size={14} />}
                  </button>
                ))}
                <button className="import-area" onClick={importMedia}>
                  <Upload size={21} />
                  <strong>Bring your own light</strong>
                  <span>Import images or videos</span>
                  <small>PNG, JPG, WebP · MP4, WebM, MOV*</small>
                </button>
                <p className="media-note">
                  Files stay on your computer. Video is muted and loops. *Codec
                  support varies.
                </p>
              </div>
            )}
          </div>
          <div className="left-bottom">
            <span className="status-dot" />
            Offline by design<span>MIT licensed</span>
          </div>
        </aside>
        <section className="center-panel">
          <div className="canvas-toolbar">
            <div className="view-label">
              <span className="status-dot" />
              Mapping view
            </div>
            <div className="canvas-actions">
              <button
                className={`audio-shortcut ${audioFocus ? "active" : ""}`}
                aria-label="Open audio react controls"
                aria-pressed={audioFocus}
                onClick={() => {
                  setAudioFocus(true);
                  setOutputSettings(false);
                  requestAnimationFrame(() => {
                    const panel = document.getElementById(
                      "audio-react-panel",
                    ) as HTMLDetailsElement | null;
                    if (panel) {
                      panel.open = true;
                      panel.closest(".inspector")?.scrollTo({ top: 0 });
                      panel
                        .querySelector("summary")
                        ?.focus({ preventScroll: true });
                    }
                  });
                }}
              >
                <AudioLines size={14} />
                Audio react
              </button>
              <button
                className="icon-button"
                aria-label="Undo"
                title="Undo · ⌘Z"
                disabled={!history.past.length}
                onClick={undo}
              >
                <Undo2 size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Redo"
                title="Redo · ⇧⌘Z"
                disabled={!history.future.length}
                onClick={redo}
              >
                <Redo2 size={16} />
              </button>
              <span className="separator" />
              <span className="fit-label">
                FIT <Maximize size={12} />
              </span>
            </div>
          </div>
          <div className="mapping-tools" aria-label="Mapping tools">
            <button
              className={tool === "select" ? "active" : ""}
              onClick={cancelDrawing}
              aria-label="Select tool"
              title="Select and move · V"
            >
              <MousePointer2 size={14} />
              Select
            </button>
            <button
              className={tool === "polygon" ? "active" : ""}
              onClick={() => startDrawing("polygon")}
              aria-label="Line tool"
              title="Click each corner, then click the first point to close · P"
            >
              <PenTool size={14} />
              Line tool
            </button>
            <span className="separator" />
            <button
              onClick={() => addPreset("rectangle")}
              aria-label="Add rectangle"
              title="Perspective rectangle"
            >
              <Square size={15} />
              <span>Rect</span>
            </button>
            <button
              onClick={() => addPreset("square")}
              aria-label="Add square"
              title="Square"
            >
              <Square size={13} />
              <span>Square</span>
            </button>
            <button
              onClick={() => addPreset("triangle")}
              aria-label="Add triangle"
              title="Triangle"
            >
              <Triangle size={15} />
              <span>Triangle</span>
            </button>
            <button
              onClick={() => addPreset("circle")}
              aria-label="Add circle"
              title="Circle"
            >
              <Circle size={15} />
              <span>Circle</span>
            </button>
            <button
              className={tool === "mask" ? "active mask-tool" : ""}
              onClick={() => startDrawing("mask")}
              aria-label="Draw cutout mask"
              title="Draw a black cutout over lower layers"
            >
              <Scissors size={14} />
              <span>Mask</span>
            </button>
            <div className="mapping-tool-options">
              <button
                className={snap ? "active" : ""}
                onClick={() => setSnap(!snap)}
                aria-label="Toggle snapping"
                aria-pressed={snap}
                title="Snap to other layers’ points"
              >
                <Magnet size={14} />
              </button>
              <button
                className={guides ? "active" : ""}
                onClick={() => setGuides(!guides)}
                aria-label="Show projector guides"
                aria-pressed={guides}
                title="Show this outline on projector · G"
              >
                <ScanLine size={14} />
              </button>
            </div>
          </div>
          {tool !== "select" && (
            <div
              className={`drawing-instructions ${tool === "mask" ? "mask-instructions" : ""}`}
              role="status"
            >
              <span className="status-dot" />
              <span>
                {draft.length
                  ? `${draft.length} points · Click the first point to close`
                  : `${tool === "mask" ? "Cutout mask" : "Line tool"} · Click to place the first point`}
              </span>
              <button onClick={finishDrawing} disabled={draft.length < 3}>
                Close outline ↵
              </button>
              <button aria-label="Cancel drawing" onClick={cancelDrawing}>
                <X size={13} />
              </button>
            </div>
          )}
          {solo && (
            <div className="solo-notice">
              Solo preview · only this layer and cutouts are shown
              <button onClick={() => setSolo(null)}>Show all layers</button>
            </div>
          )}
          <div className="canvas-area" ref={canvasArea}>
            <div className="stage-frame" style={{ width: previewSize.width }}>
              <div className="stage-caption">
                <span>OUTPUT CANVAS</span>
                <span>
                  {project.width} × {project.height}
                </span>
              </div>
              <div
                className={`stage ${tool !== "select" ? "drawing-stage" : ""}`}
                ref={stage}
                style={{ height: previewSize.height }}
                onPointerMove={onMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={insertPoint}
              >
                <canvas
                  ref={canvas}
                  width={previewSize.width}
                  height={previewSize.height}
                />
                <svg
                  className="mapping-overlay"
                  viewBox={`0 0 ${project.width} ${project.height}`}
                  preserveAspectRatio="none"
                  onPointerDown={stagePointerDown}
                >
                  {renderProject.surfaces
                    .filter((s) => s.visible)
                    .map((s) => (
                      <g
                        key={s.id}
                        className={`${selected === s.id ? "active-quad" : "inactive-quad"} ${s.kind === "mask" ? "mask-quad" : ""}`}
                      >
                        <polygon
                          points={surfacePoints(s)
                            .map(
                              (p) =>
                                `${p.x * project.width},${p.y * project.height}`,
                            )
                            .join(" ")}
                          vectorEffect="non-scaling-stroke"
                        />
                        <text
                          x={s.corners[0].x * project.width + 14}
                          y={s.corners[0].y * project.height + 28}
                          fontSize={project.width / 90}
                          className="surface-label"
                        >
                          {s.name.toUpperCase()}
                        </text>
                      </g>
                    ))}
                  {tool !== "select" && draft.length > 0 && (
                    <g
                      className={`draft-outline ${tool === "mask" ? "draft-mask" : ""}`}
                    >
                      <polyline
                        points={[
                          ...draft,
                          ...(draftCursor ? [draftCursor] : []),
                        ]
                          .map(
                            (p) =>
                              `${p.x * project.width},${p.y * project.height}`,
                          )
                          .join(" ")}
                        vectorEffect="non-scaling-stroke"
                      />
                      <line
                        x1={(draftCursor || draft.at(-1)!).x * project.width}
                        y1={(draftCursor || draft.at(-1)!).y * project.height}
                        x2={draft[0].x * project.width}
                        y2={draft[0].y * project.height}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  )}
                </svg>
                {tool !== "select" &&
                  draft.map((p, i) => (
                    <button
                      key={`draft-${i}`}
                      className={`draft-handle ${i === 0 ? "first-point" : ""}`}
                      style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                      aria-label={
                        i === 0
                          ? "Close outline at first point"
                          : `Draft point ${i + 1}`
                      }
                      title={
                        i === 0
                          ? "Click to close the outline"
                          : `Point ${i + 1}`
                      }
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (i === 0) finishDrawing();
                      }}
                    >
                      <span>{i + 1}</span>
                    </button>
                  ))}
                {tool === "select" &&
                  surface?.visible &&
                  selectedPoints.map((p, i) => (
                    <button
                      key={i}
                      className={`corner-handle ${corner === i ? "active" : ""} ${surface.locked ? "locked" : ""}`}
                      style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                      onPointerDown={(e) => beginDrag(e, i)}
                      onClick={() => setCorner(i)}
                      aria-label={
                        surface.polygon
                          ? `Point ${i + 1}`
                          : `Corner ${i + 1}: ${corners[i]}`
                      }
                      title={
                        surface.polygon
                          ? `Point ${i + 1}`
                          : `${corners[i]} · ${i + 1}`
                      }
                    >
                      <span>{i + 1}</span>
                    </button>
                  ))}
                {project.blackout && (
                  <div className="blackout-overlay">
                    <Circle size={18} /> Output blacked out <kbd>B</kbd>
                  </div>
                )}
                {!project.surfaces.length && tool === "select" && (
                  <div className="canvas-empty">
                    <Layers size={28} />
                    <span>Add a surface to start mapping</span>
                  </div>
                )}
              </div>
              <div className="stage-below">
                <span>
                  <Move size={13} />
                  {tool !== "select"
                    ? "Shift: straight angles · Backspace: undo point · Esc: cancel"
                    : surface?.polygon
                      ? "Drag points · Double-click an edge to add a point"
                      : "Drag a layer or its corners"}
                </span>
                <span>
                  <kbd>P</kbd> draw · <kbd>G</kbd> guides{" "}
                  <span className="tiny-separator">/</span> arrow keys to fine
                  tune
                </span>
              </div>
            </div>
          </div>
          <div className="transport">
            <div className="transport-left">
              <button
                className="play-button"
                onClick={() =>
                  setProject({ ...project, playing: !project.playing })
                }
                aria-label={
                  project.playing ? "Pause playback" : "Resume playback"
                }
              >
                {project.playing ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <span>
                {project.playing ? "Playing" : "Paused"}
                <small>
                  {surface
                    ? patternNames[surface.source] || "Local media"
                    : "No surface selected"}
                </small>
              </span>
            </div>
            <div className="transport-right">
              <span className="status-dot" />
              <span>
                {fps} <small>FPS</small>
              </span>
              <span className="separator" />
              <span>WebGL</span>
              <span className="loop-chip">LOOP</span>
            </div>
          </div>
          <div className="getting-started">
            <span className="step-index">01</span>
            <div>
              <strong>Start with something simple.</strong>
              <p>
                Point your projector at a box or wall. Use the calibration grid,
                then use corners or the Line tool to fit the light.
              </p>
            </div>
            <button onClick={() => setHelp(true)} aria-label="Open setup guide">
              Setup guide <span>↗</span>
            </button>
          </div>
        </section>
        <aside className="right-panel">
          <div className="panel-heading">
            <h2>
              <SlidersHorizontal size={15} />
              Surface inspector
            </h2>
            <span className="eyebrow">
              {surface?.kind === "mask"
                ? "CUTOUT"
                : surface?.polygon
                  ? `${selectedPoints.length} POINTS`
                  : "QUAD"}
            </span>
          </div>
          <div
            className="inspector-tabs"
            role="tablist"
            aria-label="Inspector view"
          >
            <button
              role="tab"
              id="surface-tab"
              aria-controls="surface-view"
              aria-selected={!audioFocus}
              onClick={() => {
                setAudioFocus(false);
                setOutputSettings(true);
              }}
            >
              Surface
            </button>
            <button
              role="tab"
              id="audio-tab"
              aria-controls="audio-view"
              aria-selected={audioFocus}
              onClick={() => {
                setAudioFocus(true);
                setOutputSettings(false);
              }}
            >
              Audio react
            </button>
          </div>
          <div className="inspector">
            <div
              role="tabpanel"
              id="surface-view"
              aria-labelledby="surface-tab"
              hidden={audioFocus}
            >
              {surface ? (
                <>
                  <div className="surface-name">
                    <input
                      aria-label="Surface name"
                      value={surface.name}
                      maxLength={60}
                      onChange={(e) => updateSurface({ name: e.target.value })}
                    />
                    <button
                      className={`icon-button ${surface.locked ? "accent" : ""}`}
                      onClick={() => updateSurface({ locked: !surface.locked })}
                      aria-label={
                        surface.locked ? "Unlock surface" : "Lock surface"
                      }
                    >
                      {surface.locked ? (
                        <LockKeyhole size={16} />
                      ) : (
                        <UnlockKeyhole size={16} />
                      )}
                    </button>
                  </div>
                  <div className="layer-properties">
                    <label>
                      Layer type
                      <select
                        aria-label="Layer type"
                        value={surface.kind || "surface"}
                        onChange={(e) => {
                          setMix(false);
                          updateSurface({
                            kind: e.target.value as "surface" | "mask",
                          });
                        }}
                      >
                        <option value="surface">Animation surface</option>
                        <option value="mask">Blackout cutout</option>
                      </select>
                    </label>
                    <label>
                      Blend
                      <select
                        aria-label="Layer blend mode"
                        disabled={surface.kind === "mask"}
                        value={surface.blendMode || "normal"}
                        onChange={(e) =>
                          updateSurface({
                            blendMode: e.target.value as Surface["blendMode"],
                          })
                        }
                      >
                        <option value="normal">Normal</option>
                        <option value="add">Add light</option>
                        <option value="screen">Screen</option>
                      </select>
                    </label>
                  </div>
                  {surface.kind === "mask" && (
                    <p className="mask-explainer">
                      Blocks layers below. Place cutouts above areas you want to
                      keep dark.
                    </p>
                  )}
                  <div className="field-label">
                    SOURCE{" "}
                    <span>
                      {project.media.find((m) => m.id === surface.source)
                        ?.kind === "video"
                        ? "LOOPING VIDEO"
                        : "MATERIAL"}
                    </span>
                  </div>
                  <select
                    aria-label="Surface source"
                    disabled={surface.kind === "mask"}
                    value={surface.source}
                    onChange={(e) => choosePattern(e.target.value)}
                  >
                    {PATTERNS.map((p) => (
                      <option key={p} value={p}>
                        {patternNames[p]}
                      </option>
                    ))}
                    {project.media.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  {material?.animated && surface.kind !== "mask" && (
                    <div className="animation-controls">
                      <p className="animation-description">
                        {material.description}
                      </p>
                      <div className="field-label section-gap">
                        SPEED <span>{(surface.speed ?? 1).toFixed(2)}×</span>
                      </div>
                      <input
                        type="range"
                        aria-label="Animation speed"
                        min="0"
                        max="3"
                        step="0.05"
                        value={surface.speed ?? 1}
                        onChange={(e) =>
                          updateSurface({ speed: Number(e.target.value) })
                        }
                      />
                      <div className="speed-presets">
                        {[0.25, 0.5, 1, 2].map((speed) => (
                          <button
                            key={speed}
                            className={
                              (surface.speed ?? 1) === speed ? "active" : ""
                            }
                            aria-label={`Animation speed ${speed}x`}
                            onClick={() => updateSurface({ speed })}
                          >
                            {speed}×
                          </button>
                        ))}
                      </div>
                      <div className="field-label section-gap">
                        DETAIL <span>{(surface.detail ?? 1).toFixed(2)}×</span>
                      </div>
                      <input
                        type="range"
                        aria-label="Animation detail"
                        min="0.5"
                        max="3"
                        step="0.05"
                        value={surface.detail ?? 1}
                        onChange={(e) =>
                          updateSurface({ detail: Number(e.target.value) })
                        }
                      />
                      <p className="field-help">
                        Less detail makes larger shapes. Speed 0 freezes this
                        surface.
                      </p>
                    </div>
                  )}
                  {(surface.source === "solid" ||
                    material?.category === "Shape") &&
                    surface.kind !== "mask" && (
                      <label className="color-field">
                        Accent color
                        <input
                          type="color"
                          aria-label="Surface color"
                          value={surface.color}
                          onChange={(e) =>
                            updateSurface({ color: e.target.value })
                          }
                        />
                      </label>
                    )}
                  {material?.category === "Shape" &&
                    surface.kind !== "mask" && (
                      <>
                        <div className="field-label section-gap">
                          OUTLINE WIDTH{" "}
                          <span>{surface.edgeWidth ?? 10} px</span>
                        </div>
                        <input
                          type="range"
                          aria-label="Outline width"
                          min="1"
                          max="80"
                          step="1"
                          value={surface.edgeWidth ?? 10}
                          onChange={(e) =>
                            updateSurface({ edgeWidth: Number(e.target.value) })
                          }
                        />
                      </>
                    )}
                  <div className="field-label section-gap">
                    SOFT EDGE <span>{surface.feather ?? 0} px</span>
                  </div>
                  <input
                    type="range"
                    aria-label="Edge feather"
                    min="0"
                    max="80"
                    step="1"
                    value={surface.feather ?? 0}
                    onChange={(e) =>
                      updateSurface({ feather: Number(e.target.value) })
                    }
                  />
                  <div className="field-label section-gap">
                    OPACITY <span>{Math.round(surface.opacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    aria-label="Surface opacity"
                    min="0"
                    max="1"
                    step="0.01"
                    value={surface.opacity}
                    onChange={(e) =>
                      updateSurface({ opacity: Number(e.target.value) })
                    }
                  />
                  <div className="inspector-divider" />
                  <div className="field-label">
                    {surface.polygon ? "OUTLINE POINTS" : "CORNER PINNING"}{" "}
                    <Crosshair size={13} />
                  </div>
                  {surface.polygon ? (
                    <select
                      aria-label="Selected outline point"
                      value={corner}
                      onChange={(e) => setCorner(Number(e.target.value))}
                    >
                      {selectedPoints.map((_, i) => (
                        <option key={i} value={i}>
                          Point {i + 1} of {selectedPoints.length}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="corner-selector">
                      {corners.map((name, i) => (
                        <button
                          key={name}
                          className={corner === i ? "active" : ""}
                          onClick={() => setCorner(i)}
                          title={name}
                        >
                          <span>{i + 1}</span>
                          {["TL", "TR", "BR", "BL"][i]}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="coordinates">
                    {(["x", "y"] as const).map((axis) => (
                      <label key={axis}>
                        <span>{axis.toUpperCase()}</span>
                        <input
                          aria-label={`${surface.polygon ? `Point ${corner + 1}` : corners[corner]} ${axis.toUpperCase()} coordinate`}
                          type="number"
                          step="1"
                          min="0"
                          max={axis === "x" ? project.width : project.height}
                          disabled={surface.locked}
                          value={Math.round(
                            (point?.[axis] || 0) *
                              (axis === "x" ? project.width : project.height),
                          )}
                          onChange={(e) => {
                            if (
                              point &&
                              Number.isFinite(e.target.valueAsNumber)
                            )
                              updateSurface(
                                moveSurfacePoint(surface, corner, {
                                  ...point,
                                  [axis]:
                                    e.target.valueAsNumber /
                                    (axis === "x"
                                      ? project.width
                                      : project.height),
                                }),
                              );
                          }}
                        />
                        <small>px</small>
                      </label>
                    ))}
                  </div>
                  <p className="field-help">
                    {surface.locked
                      ? "Unlock this surface to adjust its corners."
                      : "Arrow keys move 1 px. Hold Shift for 10 px."}
                  </p>
                  {surface.polygon ? (
                    <button
                      className="text-button"
                      disabled={surface.locked || selectedPoints.length <= 3}
                      onClick={() => {
                        const next = removeSurfacePoint(surface, corner);
                        if (next === surface) {
                          message(
                            "That point cannot be removed without crossing edges.",
                          );
                          return;
                        }
                        updateSurface(next);
                        setCorner(Math.max(0, corner - 1));
                      }}
                    >
                      <Trash2 size={13} />
                      Remove selected point
                    </button>
                  ) : (
                    <button
                      className="text-button"
                      disabled={surface.locked}
                      onClick={() =>
                        updateSurface({ corners: newSurface(0).corners })
                      }
                    >
                      <RotateCcw size={13} />
                      Reset corners
                    </button>
                  )}
                  {surface.kind !== "mask" && (
                    <details className="content-transform">
                      <summary>Content positioning</summary>
                      <p className="field-help">
                        Move the animation inside its outline.
                      </p>
                      {(
                        [
                          {
                            key: "rotation",
                            label: "Rotation",
                            min: -180,
                            max: 180,
                            step: 1,
                            unit: "°",
                          },
                          {
                            key: "scale",
                            label: "Zoom",
                            min: 0.1,
                            max: 4,
                            step: 0.05,
                            unit: "×",
                          },
                          {
                            key: "offsetX",
                            label: "Horizontal",
                            min: -1,
                            max: 1,
                            step: 0.01,
                            unit: "",
                          },
                          {
                            key: "offsetY",
                            label: "Vertical",
                            min: -1,
                            max: 1,
                            step: 0.01,
                            unit: "",
                          },
                        ] as const
                      ).map((f) => (
                        <label key={f.key}>
                          <span>
                            {f.label}
                            <small>
                              {(
                                surface.content?.[f.key] ??
                                (f.key === "scale" ? 1 : 0)
                              ).toFixed(f.key === "rotation" ? 0 : 2)}
                              {f.unit}
                            </small>
                          </span>
                          <input
                            aria-label={`Content ${f.label.toLowerCase()}`}
                            type="range"
                            min={f.min}
                            max={f.max}
                            step={f.step}
                            value={
                              surface.content?.[f.key] ??
                              (f.key === "scale" ? 1 : 0)
                            }
                            onChange={(e) =>
                              updateSurface({
                                content: {
                                  rotation: 0,
                                  scale: 1,
                                  offsetX: 0,
                                  offsetY: 0,
                                  ...surface.content,
                                  [f.key]: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                      <button
                        className="text-button"
                        onClick={() =>
                          updateSurface({
                            content: {
                              rotation: 0,
                              scale: 1,
                              offsetX: 0,
                              offsetY: 0,
                            },
                          })
                        }
                      >
                        Reset content position
                      </button>
                    </details>
                  )}
                  <div className="inspector-divider" />
                  <div className="surface-tools">
                    <button onClick={duplicate} title="Duplicate surface">
                      <Copy size={15} />
                      Duplicate
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => moveLayer(1)}
                      aria-label="Bring surface forward"
                      title="Bring forward"
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => moveLayer(-1)}
                      aria-label="Send surface backward"
                      title="Send backward"
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={remove}
                      disabled={surface.locked}
                      aria-label="Delete surface"
                      title="Delete surface"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty">Select a surface to edit it.</div>
              )}
            </div>
            <div
              role="tabpanel"
              id="audio-view"
              aria-labelledby="audio-tab"
              hidden={!audioFocus}
            >
              <AudioPanel surface={surface} onChange={updateSurface} />
            </div>
          </div>
          <div className={`output-panel ${outputSettings ? "" : "compact"}`}>
            <div className="panel-heading">
              <h2>
                <Monitor size={15} />
                Projector output
              </h2>
              <span className={`output-badge ${output.open ? "live" : ""}`}>
                {output.open ? "LIVE" : "STANDBY"}
              </span>
              <button
                className="icon-button output-settings-toggle"
                aria-label="Toggle projector settings"
                aria-expanded={outputSettings}
                onClick={() => setOutputSettings(!outputSettings)}
              >
                <ChevronDown size={13} />
              </button>
            </div>
            <div className="output-settings" hidden={!outputSettings}>
              <label className="field-label" htmlFor="display">
                TARGET DISPLAY
              </label>
              <select
                id="display"
                value={displayId ?? ""}
                disabled={output.open || !displays.length}
                onChange={(e) => setDisplayId(Number(e.target.value))}
              >
                {displays.length ? (
                  displays.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label || `Display ${d.id}`}
                      {d.internal ? " · Built-in" : ""}
                    </option>
                  ))
                ) : (
                  <option>
                    {api ? "No displays detected" : "Desktop app required"}
                  </option>
                )}
              </select>
              <p className="display-meta">
                {display
                  ? `${display.size.width} × ${display.size.height} · ${display.primary ? "Primary display" : "Extended display"}`
                  : api
                    ? "Connect your projector and extend your desktop."
                    : "Preview mode · Launch desktop for projector output"}
              </p>
              {display?.internal && (
                <p className="inline-note">
                  Only your built-in display is selected. Choose the projector
                  above when it appears.
                </p>
              )}
              <div className="resolution-row">
                <span>Canvas</span>
                <select
                  aria-label="Canvas resolution"
                  value={`${project.width}x${project.height}`}
                  onChange={(e) => {
                    const [width, height] = e.target.value
                      .split("x")
                      .map(Number);
                    update({ width, height });
                  }}
                >
                  <option value="1920x1080">1920 × 1080</option>
                  <option value="1280x720">1280 × 720</option>
                  <option value="1920x1200">1920 × 1200</option>
                  <option value="1024x768">1024 × 768</option>
                  <option value="3840x2160">3840 × 2160</option>
                </select>
              </div>
              <div className="field-label section-gap">
                <span className="brightness-label">
                  <Sun size={13} />
                  MASTER BRIGHTNESS
                </span>
                <span>{Math.round(project.brightness * 100)}%</span>
              </div>
              <input
                type="range"
                aria-label="Master brightness"
                min="0"
                max="1"
                step="0.01"
                value={project.brightness}
                onChange={(e) =>
                  setProject({ ...project, brightness: Number(e.target.value) })
                }
              />
            </div>
            <button
              aria-label={
                output.open ? "Close projector output" : "Open projector output"
              }
              className={`output-button ${output.open ? "running" : ""}`}
              disabled={!api || displayId === undefined || busyOutput}
              onClick={toggleOutput}
            >
              <Monitor size={16} />
              {busyOutput
                ? "Connecting…"
                : output.open
                  ? "Close projector output"
                  : "Open projector output"}
              <span>↗</span>
            </button>
            <button
              aria-label={project.blackout ? "Restore light" : "Blackout"}
              className={`blackout-button ${project.blackout ? "active" : ""}`}
              onClick={blackout}
            >
              <Circle size={14} />
              {project.blackout ? "Restore light" : "Blackout"}
              <kbd>B</kbd>
            </button>
            <p className="output-note">
              {output.open
                ? "Output is live. Press Esc to close it."
                : "A clean, fullscreen window on your projector."}
            </p>
          </div>
        </aside>
      </main>
      <footer>
        <span>
          <span className="status-dot" />{" "}
          {output.open ? "Projector connected" : "Ready when you are"}
        </span>
        <span>
          <Keyboard size={13} /> Space: play / pause{" "}
          <span className="tiny-separator">·</span> B: blackout{" "}
          <span className="tiny-separator">·</span> ⌘Z: undo
        </span>
        <span>Made for light.</span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Your first mapping"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              className="icon-button close-modal"
              aria-label="Close setup guide"
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">FROM SCREEN TO SPACE</span>
            <h1>
              Your first little
              <br />
              light installation.
            </h1>
            <p>All you need is a projector, an object, and a few minutes.</p>
            <ol>
              <li>
                <strong>Extend your desktop.</strong>
                <span>
                  In macOS System Settings → Displays, set the projector to an
                  extended display. Place the projector so your object is fully
                  inside its beam.
                </span>
              </li>
              <li>
                <strong>Find the edges.</strong>
                <span>
                  Choose your projector under Target display and open output.
                  Use a rectangle for a flat face, or the Line tool to trace
                  each corner. Click the first point again to close your
                  outline.
                </span>
              </li>
              <li>
                <strong>Make it yours.</strong>
                <span>
                  Each outline is its own layer. Select a layer and choose an
                  animation; try Shape effects to light its edges. Add a Mask to
                  cut light out around a window or doorway. Save your project to
                  keep the layout.
                </span>
              </li>
            </ol>
            <div className="help-tip">
              <kbd>G</kbd> shows your outline on the projector. <kbd>B</kbd>
              instantly blacks out the light.
            </div>
            <button
              className="output-button"
              onClick={() => {
                setHelp(false);
                cancelDrawing();
                if (surface) choosePattern("grid");
              }}
            >
              Start with the calibration grid <Crosshair size={16} />
            </button>
            <DeviceSection storage={device.storage} />
          </section>
        </div>
      )}
      <input
        hidden
        ref={mediaInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
        multiple
        onChange={(e) => {
          importBrowserFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={projectInput}
        type="file"
        accept=".json,.prism.json"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            if (file.size > 5 * 1024 * 1024)
              throw new Error("Project files must be smaller than 5 MB.");
            const next = validateBrowserProject(JSON.parse(await file.text()));
            commit({
              ...next,
              media: [],
              surfaces: next.surfaces.map((s) => ({
                ...s,
                source: PATTERNS.includes(s.source as any) ? s.source : "grid",
              })),
              blackout: true,
            });
            message(
              "Project loaded in blackout. Browser media must be reimported.",
            );
          } catch (err) {
            setError(String(err));
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  location.hash === "#output" ? <Output /> : <App />,
);
