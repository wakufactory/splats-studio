import test from "node:test";
import assert from "node:assert/strict";
import { RenderWatchdog } from "./render-watchdog.mjs";

test("normal rendering and occasional slow frames keep running", () => {
  const guard = new RenderWatchdog();
  for (const start of [0, 16, 32, 632, 648, 664, 1264, 1280]) {
    assert.equal(guard.sample(start, start + 5), false);
  }
});

test("sustained low frame rate stops until explicitly reset", () => {
  const guard = new RenderWatchdog();
  assert.equal(guard.sample(0, 5), false);
  assert.equal(guard.sample(600, 605), false);
  assert.equal(guard.sample(1200, 1205), false);
  assert.equal(guard.sample(1800, 1805), true);
  guard.resetTiming(); // Hiding/showing the preview must not resume it.
  assert.equal(guard.sample(1816, 1821), true);
  guard.reset(); // A new successful generation resumes drawing.
  assert.equal(guard.sample(1832, 1837), false);
});

test("a single long draw stops, but hidden time is excluded", () => {
  const guard = new RenderWatchdog();
  assert.equal(guard.sample(0, 3000), true);
  guard.reset();
  guard.sample(0, 5);
  guard.resetTiming();
  assert.equal(guard.sample(60000, 60005), false);
});
