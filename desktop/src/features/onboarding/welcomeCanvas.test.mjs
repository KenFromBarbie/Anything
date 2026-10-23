import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureWelcomeCanvas,
  WELCOME_CANVAS_CONTENT,
} from "./welcomeCanvas.ts";

test("welcome canvas covers how the office works, how to start, and what to ask", () => {
  assert.match(WELCOME_CANVAS_CONTENT, /Michael/);
  assert.match(WELCOME_CANVAS_CONTENT, /permanent staff/i);
  assert.match(WELCOME_CANVAS_CONTENT, /## Start here/);
  assert.match(WELCOME_CANVAS_CONTENT, /## Things you can ask for/);
  assert.match(WELCOME_CANVAS_CONTENT, /Meeting room/);
  assert.doesNotMatch(WELCOME_CANVAS_CONTENT, /Fizz|Honey|Pollen/);
});

test("ensureWelcomeCanvas seeds a fresh channel with no canvas", async () => {
  const writes = [];
  const seeded = await ensureWelcomeCanvas("welcome-1", {
    getCanvas: async () => ({ content: "", updatedAt: null, author: null }),
    setCanvas: async (input) => {
      writes.push(input);
      return { ok: true, eventId: "e1" };
    },
  });

  assert.equal(seeded, true);
  assert.deepEqual(writes, [
    { channelId: "welcome-1", content: WELCOME_CANVAS_CONTENT },
  ]);
});

test("ensureWelcomeCanvas seeds even when the backend omits the empty-state fields", async () => {
  // Regression: get_canvas once returned `{ content: "" }` with updated_at and
  // author absent (undefined). `!== null` treated that as an existing canvas
  // and seeding silently never ran for any fresh channel.
  const writes = [];
  const seeded = await ensureWelcomeCanvas("welcome-1", {
    getCanvas: async () => ({ content: "" }),
    setCanvas: async (input) => {
      writes.push(input);
      return { ok: true, eventId: "e1" };
    },
  });

  assert.equal(seeded, true);
  assert.equal(writes.length, 1);
});

test("ensureWelcomeCanvas never overwrites an existing canvas", async () => {
  const seeded = await ensureWelcomeCanvas("welcome-1", {
    getCanvas: async () => ({
      content: "my notes",
      updatedAt: 1_700_000_000,
      author: "a".repeat(64),
    }),
    setCanvas: async () => {
      throw new Error("must not overwrite an existing canvas");
    },
  });

  assert.equal(seeded, false);
});
