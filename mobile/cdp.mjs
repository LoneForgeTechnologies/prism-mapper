// A very small Chrome DevTools protocol client, just enough for the Android
// smoke test. It uses only the fetch and WebSocket that Node 22 ships with, so
// the CI job needs no npm install. Android's WebView speaks the same protocol
// as desktop Chrome, which lets the client be tried out against headless
// Chromium on a development machine.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok)
    throw new Error(`DevTools answered HTTP ${response.status} for /json/list`);
  return response.json();
}

// Waits until a page whose address starts with urlPrefix can be inspected.
export async function waitForPage(port, urlPrefix, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "no answer from DevTools yet";
  while (Date.now() < deadline) {
    try {
      const targets = await listTargets(port);
      const page = targets.find(
        (target) =>
          target.type === "page" &&
          target.url.startsWith(urlPrefix) &&
          target.webSocketDebuggerUrl,
      );
      if (page) return page;
      last = `pages seen: ${targets.map((target) => `${target.type} ${target.url}`).join(", ") || "none"}`;
    } catch (error) {
      last = String(error?.message ?? error);
    }
    await sleep(1000);
  }
  throw new Error(
    `No page starting with ${urlPrefix} appeared on DevTools port ${port} (${last}).`,
  );
}

export class CdpSession {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) =>
      this.#onMessage(String(event.data)),
    );
    socket.addEventListener("close", () => {
      for (const { reject } of this.#pending.values())
        reject(new Error("DevTools connection closed"));
      this.#pending.clear();
    });
  }

  static open(url, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out opening ${url}`));
      }, timeoutMs);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new CdpSession(socket));
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`Could not open ${url}`));
      });
    });
  }

  send(method, params = {}, timeoutMs = 30_000) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, handler) {
    const handlers = this.#listeners.get(event) ?? [];
    handlers.push(handler);
    this.#listeners.set(event, handlers);
  }

  // Resolves with the parameters of the next event of this kind.
  once(event, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`${event} did not arrive within ${timeoutMs} ms`)),
        timeoutMs,
      );
      this.on(event, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }

  close() {
    this.#socket.close();
  }

  #onMessage(text) {
    const message = JSON.parse(text);
    if (message.id !== undefined) {
      const waiting = this.#pending.get(message.id);
      if (!waiting) return;
      this.#pending.delete(message.id);
      if (message.error)
        waiting.reject(
          new Error(`${message.error.message} (${message.error.code})`),
        );
      else waiting.resolve(message.result);
      return;
    }
    for (const handler of this.#listeners.get(message.method) ?? [])
      handler(message.params);
  }
}
