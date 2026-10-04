/**
 * Connects the editor to device storage and the installed web app.
 *
 * - Keeps the autosaved draft current (and says so once if the browser refuses it).
 * - Stores imported media in IndexedDB and rebuilds it after a reload.
 * - Starts the offline worker and announces updates.
 *
 * The editor stays in charge of its own state. This hook only reads it and
 * pushes blob: URLs back in; a storage failure never touches the project.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Media, Project } from "./model";
import {
  MAX_MEDIA_FILES,
  SavedMedia,
  classifyStorageError,
  clearDraft,
  describeDraftProblem,
  describeMissing,
  describeRefusedFiles,
  describeSharedDraft,
  describeSkipped,
  isDraftChangedElsewhere,
  mediaFromFiles,
  mediaIdsToKeep,
  openIndexedDbBackend,
  sortPickedFiles,
  takeBootReferencedIds,
  writeDraft,
  type SavedMediaUsage,
} from "./persistence";
import { isElectron } from "./platform";
import { getPwaState, initPwa, subscribePwa } from "./pwa";

/** What the Help window needs to describe and clear what is saved on the device. */
export interface DeviceStorage {
  /** The desktop app keeps its own project files, so it has nothing to show. */
  enabled: boolean;
  readUsage(): Promise<SavedMediaUsage>;
  clearSaved(): Promise<boolean>;
}

interface Options {
  project: Project;
  setProject: Dispatch<SetStateAction<Project>>;
  /** Green notice. */
  notify: (message: string) => void;
  /** Red error. */
  fail: (message: string) => void;
}

export function usePersistence(options: Options) {
  const enabled = !isElectron();
  const latest = useRef(options);
  latest.current = options;
  const saved = useMemo(() => new SavedMedia(openIndexedDbBackend), []);
  const startMedia = useRef(options.project.media);
  const draftProblem = useRef(false);
  /** Ids of every file this page has handed to storage; the start-up cleanup never touches them. */
  const savedHere = useRef(new Set<string>());

  // Rebuild blob: URLs for media saved by an earlier visit, then clean up what nothing uses.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const { urls, missing, unavailable } = await saved.restore(
        startMedia.current,
      );
      if (cancelled) return;
      if (urls.size)
        latest.current.setProject((project) => ({
          ...project,
          media: project.media.map((m: Media) =>
            !m.url && urls.has(m.id) ? { ...m, url: urls.get(m.id)! } : m,
          ),
        }));
      if (missing.length || unavailable)
        latest.current.fail(describeMissing(missing, unavailable));
      // Decided when the cleanup runs, not now: files may have been imported,
      // and another tab may have changed the draft, while the page was starting.
      const referenced = takeBootReferencedIds();
      if (referenced)
        await saved.collectGarbage(() =>
          mediaIdsToKeep(
            referenced,
            latest.current.project.media,
            savedHere.current,
          ),
        );
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, saved]);

  // Every tab and window of this site autosaves to the same draft. When another
  // one saves it, say so once, instead of letting the last change win unseen.
  useEffect(() => {
    if (!enabled) return;
    let told = false;
    const changed = (event: StorageEvent) => {
      if (told || !isDraftChangedElsewhere(event)) return;
      told = true;
      latest.current.fail(describeSharedDraft());
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [enabled]);

  // Offline worker, install prompt and the "update ready" notice.
  useEffect(() => {
    if (!enabled) return;
    initPwa();
    let wasReady = getPwaState().updateReady;
    return subscribePwa(() => {
      const ready = getPwaState().updateReady;
      if (ready && !wasReady)
        latest.current.notify(
          "Update ready. Reload to use the newest version.",
        );
      wasReady = ready;
    });
  }, [enabled]);

  const saveDraft = useCallback(
    (project: Project) => {
      const result = writeDraft(project, { keepMedia: enabled });
      if (result.ok) draftProblem.current = false;
      else if (!draftProblem.current) {
        // Say it once, and again only if saving recovers and then fails later.
        draftProblem.current = true;
        latest.current.fail(describeDraftProblem(result.kind));
      }
    },
    [enabled],
  );

  /** Make media entries for picked files and keep their data on the device. */
  const importFiles = useCallback(
    (files: File[]): Media[] => {
      // A project file or a document picked by mistake is not media.
      const { media: usable, projects, other } = sortPickedFiles(files);
      const room = Math.max(
        0,
        MAX_MEDIA_FILES - latest.current.project.media.length,
      );
      const accepted = usable.slice(0, room);
      const problems = [
        describeRefusedFiles(projects, other),
        accepted.length < usable.length
          ? `A project can hold up to ${MAX_MEDIA_FILES} media files, so ${usable.length - accepted.length} of the files you picked were not added.`
          : null,
      ]
        .filter(Boolean)
        .join(" ");
      if (problems) latest.current.fail(problems);
      const imported = mediaFromFiles(accepted);
      for (const { media } of imported) savedHere.current.add(media.id);
      if (enabled && imported.length)
        void saved
          .save(
            imported.map(({ media, blob }) => ({
              id: media.id,
              name: media.name,
              kind: media.kind,
              blob,
            })),
          )
          .then((result) => {
            const text = describeSkipped(result.skipped, saved.limit);
            if (text) latest.current.fail(text);
          })
          .catch(() => {});
      return imported.map(({ media }) => media);
    },
    [enabled, saved],
  );

  const storage = useMemo<DeviceStorage>(
    () => ({
      enabled,
      readUsage: () => saved.usage(),
      clearSaved: async () => {
        clearDraft();
        try {
          await saved.clear();
        } catch (error) {
          // No IndexedDB at all means there was no saved media to clear.
          if (classifyStorageError(error) !== "unavailable") {
            latest.current.fail(
              `Could not clear saved media: ${error instanceof Error ? error.message : "storage error"}.`,
            );
            return false;
          }
        }
        latest.current.notify(
          "Cleared the saved draft and media on this device. Your open project is unchanged.",
        );
        return true;
      },
    }),
    [enabled, saved],
  );

  return { saveDraft, importFiles, storage };
}
