const test = require("node:test");
const assert = require("node:assert/strict");
const { createWakeLock } = require("./wakelock.cjs");

function fakeBlocker() {
  const running = new Set();
  let next = 1;
  return {
    running,
    start: (type) => {
      assert.equal(type, "prevent-display-sleep");
      const id = next++;
      running.add(id);
      return id;
    },
    stop: (id) => running.delete(id),
    isStarted: (id) => running.has(id),
  };
}

test("starting again releases the earlier request", () => {
  const blocker = fakeBlocker();
  const lock = createWakeLock(blocker);
  lock.start();
  lock.start(); // output moved to another display
  assert.equal(blocker.running.size, 1);
  assert.equal(lock.active, true);
  lock.stop();
  assert.equal(blocker.running.size, 0);
  assert.equal(lock.active, false);
});

test("stopping is safe when nothing is held or the system already released it", () => {
  const blocker = fakeBlocker();
  const lock = createWakeLock(blocker);
  lock.stop();
  const id = lock.start();
  blocker.running.delete(id);
  assert.equal(lock.active, false);
  lock.stop();
  lock.start();
  assert.equal(blocker.running.size, 1);
});
