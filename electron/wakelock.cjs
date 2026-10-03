// Keeps the projector screen from sleeping while the output window is open.
// Starting twice (for example when the output moves to another display) must
// release the first request, otherwise the computer is kept awake until the
// application quits.
function createWakeLock(blocker, type = "prevent-display-sleep") {
  let id = null;
  const stop = () => {
    if (id !== null && blocker.isStarted(id)) blocker.stop(id);
    id = null;
  };
  return {
    start() {
      stop();
      id = blocker.start(type);
      return id;
    },
    stop,
    get active() {
      return id !== null && blocker.isStarted(id);
    },
  };
}

module.exports = { createWakeLock };
