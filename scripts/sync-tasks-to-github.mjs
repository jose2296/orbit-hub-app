#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Bridges one OrbitHub list into GitHub issues.
 *
 *   node scripts/sync-tasks-to-github.mjs            report what it would do
 *   node scripts/sync-tasks-to-github.mjs --apply    do it
 *
 * Rules this script never breaks:
 *  - it never writes to the database: GitHub holds the link between a task and
 *    its issue, in a marker inside the issue body
 *  - it never overwrites what you wrote in the issue yourself
 *  - it does nothing at all without --apply
 */
const MARKER = /<!--\s*orbit-list-item:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*-->/i;

export function parseMarker(body) {
  const match = MARKER.exec(body ?? "");
  return match ? match[1] : null;
}

const TITLE_LIMIT = 120;
export { TITLE_LIMIT };

/**
 * A GitHub issue list is read by title, and 300 characters is not a title.
 * The API already truncates task titles at 300, so this is not hypothetical.
 */
export function issueTitle(title, limit = TITLE_LIMIT) {
  const trimmed = (title ?? "").trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`;
}

const MANAGED_START = "<!-- orbit:managed:start -->";
const MANAGED_END = "<!-- orbit:managed:end -->";

/**
 * Rewrites only the generated block and leaves everything around it alone.
 *
 * Writing context on an issue before handing it over is the whole point of
 * having issues at all, so a run that replaces the description wholesale would
 * destroy the thing it was built for. The block is found by its own delimiters
 * rather than by position, which is also what makes a second run a no-op: the
 * output is its own input.
 */
export function mergeBody(existing, block) {
  const body = existing ?? "";
  const start = body.indexOf(MANAGED_START);
  const end = body.indexOf(MANAGED_END);

  if (start !== -1 && end > start) {
    const before = body.slice(0, start);
    const after = body.slice(end + MANAGED_END.length);
    return `${before}${MANAGED_START}\n${block}\n${MANAGED_END}${after}`;
  }

  const trimmed = body.trim();
  const generated = `${MANAGED_START}\n${block}\n${MANAGED_END}`;
  return trimmed ? `${trimmed}\n\n${generated}` : generated;
}

/** UTC on purpose: the day a task was written should not move with the runner's timezone. */
function isoDay(value) {
  return value instanceof Date && !Number.isNaN(value.valueOf())
    ? value.toISOString().slice(0, 10)
    : null;
}

/**
 * The half of the issue this script owns. Everything here is derived from the
 * task, so a run can rebuild it from scratch and tell whether it changed.
 */
export function managedBlock(item, webOrigin) {
  const sections = [];

  const annotation = (item.annotation ?? "").trim();
  if (annotation) sections.push(`**Anotación**\n\n${annotation}`);

  // Whatever did not fit the issue title goes here, so a long task title is
  // shortened for the list without losing the sentence it was cut in half.
  const title = (item.title ?? "").trim();
  if (title.length > TITLE_LIMIT) {
    sections.push(`*(el título original continúa: "…${title.slice(TITLE_LIMIT - 1).trim()}")*`);
  }

  const meta = [`- Prioridad: \`${item.priority ?? "none"}\``];
  if (item.completed) meta.push("- Hecha");
  const created = isoDay(item.createdAt);
  if (created) meta.push(`- Creada el ${created}`);
  meta.push(`- Tarea: ${webOrigin}/item/${item.id}`);

  sections.push(meta.join("\n"));
  return sections.join("\n\n");
}

/** The body a freshly created issue gets: the marker, then the generated block. */
export function issueBody(item, webOrigin) {
  return mergeBody(`<!-- orbit-list-item: ${item.id} -->`, managedBlock(item, webOrigin));
}

/**
 * Decides what to do, without doing any of it. Returns nothing for a task that
 * is already in shape, which is what makes running this twice harmless.
 *
 * Closing wins over updating: an issue that is already closed does not need its
 * description rewritten to learn that the task got ticked off.
 */
export function planActions(tasks, issues, webOrigin) {
  const byItem = new Map();
  for (const issue of issues) {
    const itemId = parseMarker(issue.body);
    if (itemId && !byItem.has(itemId)) byItem.set(itemId, issue);
  }

  const actions = [];
  for (const item of tasks) {
    const issue = byItem.get(item.id);
    const finished = Boolean(item.completed) || Boolean(item.deletedAt);

    if (!issue) {
      // A task deleted before it ever reached GitHub has nothing to close, and
      // opening an issue for something nobody can find any more is just noise.
      if (item.deletedAt) continue;
      actions.push({
        type: "create",
        task: item,
        issue: null,
        title: issueTitle(item.title),
        body: issueBody(item, webOrigin),
      });
      continue;
    }

    if (finished && issue.state !== "CLOSED") {
      actions.push({ type: "close", task: item, issue });
      continue;
    }

    if (!finished && issue.state === "CLOSED") {
      actions.push({ type: "reopen", task: item, issue });
      continue;
    }

    // mergeBody is its own inverse, so a body already carrying the right block
    // comes back byte for byte. That equality is the whole no-op check.
    const wantedTitle = issueTitle(item.title);
    const wantedBody = mergeBody(issue.body, managedBlock(item, webOrigin));
    if (issue.title !== wantedTitle || issue.body !== wantedBody) {
      actions.push({ type: "update", task: item, issue, title: wantedTitle, body: wantedBody });
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Everything below talks to the outside world. The functions above do not, and
// that is the line this file is drawn on.
// ---------------------------------------------------------------------------

const LIST_ID = process.env.ORBIT_LIST_ID ?? "33c77e07-44f4-4b9e-b4c7-e16e87fe3d35";
const REPO = process.env.ORBIT_GH_REPO ?? "jose2296/orbit-hub-app";
const WEB_ORIGIN = process.env.ORBIT_WEB_ORIGIN ?? "https://orbithub-app.jrz-labs.com";
const LABEL = "from-orbit-task";

const log = {
  title: (text) => console.log(`\n${text}\n${"─".repeat(text.length)}`),
  ok: (text) => console.log(`  ✓ ${text}`),
  warn: (text) => console.log(`  ! ${text}`),
  fail: (text) => console.log(`  ✗ ${text}`),
  note: (text) => console.log(`    ${text}`),
};

const VERBS = {
  create: "open",
  update: "update",
  close: "close",
  reopen: "reopen",
};

/**
 * Reads the list, including the items that were deleted: those are the ones
 * whose issues have to be closed, and filtering them out here would leave
 * orphaned issues behind with nothing left to say they are done.
 *
 * The transaction is read only. This script has no reason to write here, and
 * saying so in the query is cheaper than trusting it.
 */
async function readTasks() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set.\n" +
        "    railway run node scripts/sync-tasks-to-github.mjs --apply",
    );
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query(
      `select id, title, annotation, priority, completed,
              created_at as "createdAt", updated_at as "updatedAt", deleted_at as "deletedAt"
       from list_items
       where list_id = $1
       order by position asc nulls last, created_at asc`,
      [LIST_ID],
    );
    await client.query("COMMIT");
    return rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`gh ${args[0]} failed: ${(result.stderr || "").trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

/**
 * `gh issue create` prints the URL of what it just made. That is the number of
 * this issue, which is not the same question as "what is the newest issue with
 * our label" — that one has an answer per issue but it is the same answer for
 * every issue created in the same run.
 */
export function issueNumberFrom(output) {
  const matches = [...String(output ?? "").matchAll(/\/issues\/(\d+)/g)];
  return matches.length ? Number(matches.at(-1)[1]) : null;
}

function readIssues() {
  return JSON.parse(
    gh([
      "issue", "list",
      "--repo", REPO,
      "--label", LABEL,
      "--state", "all",
      "--limit", "500",
      "--json", "number,title,body,state",
    ]),
  );
}

function ensureLabel() {
  const exists = gh(["label", "list", "--repo", REPO, "--limit", "200"]).includes(LABEL);
  if (!exists) {
    gh([
      "label", "create", LABEL,
      "--repo", REPO,
      "--description", "Apuntada en la lista de tareas de OrbitHub",
      "--color", "0e8a16",
    ]);
  }
}

function shortTitle(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 70 ? flat : `${flat.slice(0, 69)}…`;
}

function applyAction(action) {
  const number = action.issue?.number;

  switch (action.type) {
    case "create":
      return String(
        issueNumberFrom(
          gh(["issue", "create", "--repo", REPO, "--label", LABEL, "--title", action.title, "--body", action.body]),
        ),
      );
    case "update":
      gh(["issue", "edit", String(number), "--repo", REPO, "--title", action.title, "--body", action.body]);
      return String(number);
    case "close":
      gh(["issue", "close", String(number), "--repo", REPO, "--comment", closeComment(action.task)]);
      return String(number);
    case "reopen":
      gh(["issue", "reopen", String(number), "--repo", REPO, "--comment", reopenComment(action.task)]);
      return String(number);
    default:
      throw new Error(`Unknown action: ${action.type}`);
  }
}

function closeComment(task) {
  return task.deletedAt
    ? `La tarea se borró de la lista de OrbitHub.`
    : `Marcada como hecha en la lista de OrbitHub.`;
}

function reopenComment(task) {
  return `La tarea vuelve a estar pendiente en la lista de OrbitHub.`;
}

async function main() {
  const apply = process.argv.includes("--apply");

  log.title(`Lista ${LIST_ID} → ${REPO}`);
  log.note(`web ${WEB_ORIGIN}`);
  log.note(apply ? "modo --apply: esto escribe en GitHub" : "modo lectura: no se escribe nada");

  const tasks = await readTasks();
  const issues = readIssues();
  const actions = planActions(tasks, issues, WEB_ORIGIN);

  const counts = actions.reduce((total, action) => {
    total[action.type] = (total[action.type] ?? 0) + 1;
    return total;
  }, {});

  log.title(`${tasks.length} tareas, ${issues.length} issues, ${actions.length} cambios`);
  for (const verb of Object.keys(VERBS)) {
    if (counts[verb]) log.note(`${String(counts[verb]).padStart(3)}  ${VERBS[verb]}`);
  }
  if (actions.length === 0) {
    log.ok("No hay nada que hacer. Todo está en su sitio.");
    return;
  }

  for (const action of actions) {
    const where = action.issue ? `#${action.issue.number}` : "—";
    log.note(`${VERBS[action.type].padEnd(7)} ${where.padEnd(6)} ${shortTitle(action.task.title)}`);
  }

  if (!apply) {
    log.title("Nada escrito");
    log.note("Repite con --apply cuando quieras que pase.");
    return;
  }

  ensureLabel();

  log.title("Escribiendo");
  const failed = [];
  for (const action of actions) {
    try {
      const number = applyAction(action);
      log.ok(`${VERBS[action.type]} #${number}  ${shortTitle(action.task.title)}`);
    } catch (error) {
      failed.push({ action, error });
      log.fail(`${VERBS[action.type]} ${shortTitle(action.task.title)} — ${error.message}`);
    }
  }

  log.title("Resultado");
  log.note(`${actions.length - failed.length} de ${actions.length} aplicados.`);
  if (failed.length) {
    log.warn(`${failed.length} fallaron. Vuelve a lanzarlo: lo que sí salió no se repite.`);
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`\n✗ ${error.message}\n`);
    process.exitCode = 1;
  });
}
