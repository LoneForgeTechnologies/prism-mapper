export interface VideoDuration {
  duration: number;
  fallback: boolean;
}

/** Read only local metadata; unavailable or unsupported lengths remain editable. */
export function readVideoDuration(url: string): Promise<VideoDuration> {
  if (!url) return Promise.resolve({ duration: 120, fallback: true });
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let finished = false;
    const finish = (duration?: number) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", loaded);
      video.removeEventListener("error", failed);
      video.removeAttribute("src");
      video.load();
      const valid =
        duration !== undefined &&
        Number.isFinite(duration) &&
        duration >= 0.1 &&
        duration <= 7200;
      resolve(
        valid
          ? { duration: Math.round(duration * 1000) / 1000, fallback: false }
          : { duration: 120, fallback: true },
      );
    };
    const loaded = () => finish(video.duration);
    const failed = () => finish();
    const timer = setTimeout(failed, 8000);
    video.addEventListener("loadedmetadata", loaded);
    video.addEventListener("error", failed);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.load();
  });
}

/** Keep selection order while limiting simultaneous metadata decoders. */
export async function readVideoDurations(
  urls: readonly string[],
): Promise<VideoDuration[]> {
  const durations: VideoDuration[] = [];
  for (let start = 0; start < urls.length; start += 4)
    durations.push(
      ...(await Promise.all(
        urls.slice(start, start + 4).map(readVideoDuration),
      )),
    );
  return durations;
}
