import assert from "node:assert/strict";
import { test } from "node:test";

import {
  issueBody,
  issueNumberFrom,
  issueTitle,
  managedBlock,
  mergeBody,
  parseMarker,
  planActions,
  TITLE_LIMIT,
} from "./sync-tasks-to-github.mjs";

const WEB = "https://orbithub-app.jrz-labs.com";

function task(overrides = {}) {
  return {
    id: "33c77e07-44f4-4b9e-b4c7-e16e87fe3d35",
    title: "Quitar el outline de los inputs",
    annotation: null,
    priority: "none",
    completed: false,
    deletedAt: null,
    createdAt: new Date("2026-10-01T09:00:00Z"),
    updatedAt: new Date("2026-10-02T09:00:00Z"),
    ...overrides,
  };
}

test("reads the item id out of an issue body", () => {
  const body = [
    "<!-- orbit-list-item: 33c77e07-44f4-4b9e-b4c7-e16e87fe3d35 -->",
    "",
    "Contexto que escribí a mano.",
  ].join("\n");

  assert.equal(parseMarker(body), "33c77e07-44f4-4b9e-b4c7-e16e87fe3d35");
});

// Pins the null path that came along with the ternary above; it would have been
// a red test if it had been written before the implementation.
test("reports no item id for an issue that is not ours", () => {
  assert.equal(parseMarker("A bug I wrote by hand."), null);
  assert.equal(parseMarker(""), null);
  assert.equal(parseMarker(undefined), null);
});

test("leaves a title that fits alone", () => {
  assert.equal(issueTitle("Quitar el outline de los inputs"), "Quitar el outline de los inputs");
});

test("cuts a title that would be unreadable in a GitHub list", () => {
  const long = "x".repeat(300);
  const title = issueTitle(long);

  assert.equal(title.length, 120);
  assert.ok(title.endsWith("…"), "the cut is visible");
});

test("does not leave a dangling space before the ellipsis", () => {
  const title = issueTitle(`${"y".repeat(118)} zzz`);

  assert.equal(title, `${"y".repeat(118)}…`);
});

test("replaces the generated block and keeps what you wrote above it", () => {
  const existing = [
    "Contexto que escribí a mano antes de pasarle la tarea.",
    "",
    "<!-- orbit:managed:start -->",
    "lo que generó la ejecución anterior",
    "<!-- orbit:managed:end -->",
  ].join("\n");

  const result = mergeBody(existing, "lo que genera esta ejecución");

  assert.ok(result.startsWith("Contexto que escribí a mano antes de pasarle la tarea."));
  assert.ok(result.includes("lo que genera esta ejecución"));
  assert.ok(!result.includes("lo que generó la ejecución anterior"));
});

test("appends the block to an issue that does not have one yet", () => {
  const result = mergeBody("Solo mi nota.", "BLOQUE");

  assert.ok(result.startsWith("Solo mi nota."));
  assert.ok(result.includes("BLOQUE"));
});

test("merging twice changes nothing, so a re-run cannot duplicate the block", () => {
  const once = mergeBody("nota", "BLOQUE");
  const twice = mergeBody(once, "BLOQUE");

  assert.equal(twice, once);
  assert.equal(twice.match(/orbit:managed:start/g).length, 1);
});

test("an empty issue body becomes just the block, delimiters included", () => {
  // The delimiters travel with the block: without them the next run would not
  // find it to replace, and would append a second one.
  const expected = "<!-- orbit:managed:start -->\nBLOQUE\n<!-- orbit:managed:end -->";

  assert.equal(mergeBody("", "BLOQUE").trim(), expected);
  assert.equal(mergeBody(undefined, "BLOQUE").trim(), expected);
});

test("the block carries the annotation when the task has one", () => {
  const block = managedBlock(task({ annotation: "Ver qué hacer con el teclado" }), WEB);

  assert.match(block, /\*\*Anotación\*\*/);
  assert.ok(block.includes("Ver qué hacer con el teclado"));
});

test("the block leaves the annotation out when the task has none", () => {
  const block = managedBlock(task({ annotation: null }), WEB);

  assert.ok(!block.includes("Anotación"));
});

test("the block shows the part of the title that did not fit", () => {
  const title = "A".repeat(300);
  const block = managedBlock(task({ title }), WEB);

  assert.match(block, /título original continúa/);
  assert.ok(issueTitle(title).endsWith("…"));
  // The quoted tail is exactly the part the shortened title left out, so a
  // sentence is never cut in half and dropped.
  assert.ok(block.includes(`…${title.slice(TITLE_LIMIT - 1)}"`));
});

test("the block links to the task in the app", () => {
  const block = managedBlock(task(), WEB);

  assert.ok(block.includes(`${WEB}/item/33c77e07-44f4-4b9e-b4c7-e16e87fe3d35`));
});

test("the block states the priority and the day the task was written", () => {
  const block = managedBlock(task({ priority: "high" }), WEB);

  assert.match(block, /Prioridad.*`high`/);
  assert.ok(block.includes("2026-10-01"));
});

test("the block says the task is already done", () => {
  const block = managedBlock(task({ completed: true }), WEB);

  assert.match(block, /Hecha/);
});

/** An issue that is exactly what the last run would have produced for this task. */
function issueFor(item, overrides = {}) {
  return {
    number: 101,
    title: issueTitle(item.title),
    body: issueBody(item, WEB),
    state: "OPEN",
    ...overrides,
  };
}

test("a task with no issue of its own gets one", () => {
  const actions = planActions([task()], [], WEB);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "create");
});

test("a task that has not changed produces no action at all", () => {
  const item = task();
  const actions = planActions([item], [issueFor(item)], WEB);

  assert.deepEqual(actions, [], "a second run must be a no-op");
});

test("a renamed task updates the issue title", () => {
  const before = task();
  const after = task({ title: "Quitar el outline de los inputs (y los selects)" });
  const actions = planActions([after], [issueFor(before, { number: 7 })], WEB);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "update");
  assert.equal(actions[0].title, "Quitar el outline de los inputs (y los selects)");
  assert.equal(actions[0].issue.number, 7);
});

test("a task marked as done closes its issue", () => {
  const before = task();
  const actions = planActions([task({ completed: true })], [issueFor(before)], WEB);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "close");
});

test("a task deleted from the app closes its issue too", () => {
  const before = task();
  const deleted = task({ deletedAt: new Date("2026-10-03T09:00:00Z") });
  const actions = planActions([deleted], [issueFor(before)], WEB);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "close");
});

test("a task opened again reopens its issue", () => {
  const done = task({ completed: true });
  const actions = planActions([task()], [issueFor(done, { state: "CLOSED" })], WEB);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "reopen");
});

test("an update leaves the text you wrote on the issue alone", () => {
  const before = task();
  const issue = issueFor(before, {
    body: `${issueBody(before, WEB)}\n\nRepartido: lo del input en web lo hago yo.`,
  });
  const after = task({ annotation: "Ver qué hacer con el teclado" });

  const actions = planActions([after], [issue], WEB);
  const body = actions[0].body;

  assert.equal(actions[0].type, "update");
  assert.ok(body.includes("Repartido: lo del input en web lo hago yo."));
  assert.ok(body.includes("Ver qué hacer con el teclado"));
  assert.equal(body.match(/orbit:managed:start/g).length, 1);
});

test("an issue of somebody else's is not mistaken for ours", () => {
  const actions = planActions([task()], [{ number: 3, title: "Un bug real", body: "nada que ver", state: "OPEN" }], WEB);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "create", "the task still needs its own issue");
});

test("a deleted task that never had an issue does not get one", () => {
  const deleted = task({ deletedAt: new Date("2026-10-03T09:00:00Z") });

  assert.deepEqual(planActions([deleted], [], WEB), []);
});

test("reads the issue number out of the URL gh prints when it creates one", () => {
  assert.equal(issueNumberFrom("https://github.com/jose2296/orbit-hub-app/issues/30\n"), 30);
});

test("takes the last number when gh printed more than one line", () => {
  const output = ["Creating issue in jose2296/orbit-hub-app", "https://github.com/jose2296/orbit-hub-app/issues/7", ""].join("\n");

  assert.equal(issueNumberFrom(output), 7);
});

test("has no number to report when gh printed no URL", () => {
  assert.equal(issueNumberFrom(""), null);
  assert.equal(issueNumberFrom("something went wrong"), null);
});




