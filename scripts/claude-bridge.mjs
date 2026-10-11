#!/usr/bin/env node
// Host-side bridge that lets the NetCam API (inside Docker) run Claude Code
// on this PC. The API forwards WhatsApp messages from the owner's number;
// each WhatsApp conversation keeps its own Claude session so follow-ups
// have context. Plain Node, no dependencies, runs as the desktop user so
// Claude uses that user's login and home directory.
//
// Numbers the API marks as engine "codex" get OpenAI Codex (codex exec)
// instead of Claude, with the same menus.
//
// SECURITY: whoever can call /run fully controls this PC (Claude runs with
// --dangerously-skip-permissions, Codex with
// --dangerously-bypass-approvals-and-sandbox). It only listens on the Docker bridge and
// every request must carry CLAUDE_BRIDGE_SECRET.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { timingSafeEqual } from "node:crypto";

const HOST = process.env.CLAUDE_BRIDGE_HOST ?? "172.17.0.1";
const PORT = Number(process.env.CLAUDE_BRIDGE_PORT ?? 8790);
const SECRET = process.env.CLAUDE_BRIDGE_SECRET ?? "";
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const CODEX_BIN = process.env.CODEX_BIN ?? "codex";
const CODEX_HOME = process.env.CODEX_HOME ?? join(homedir(), ".codex");
const CWD = process.env.CLAUDE_CWD ?? homedir();
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS ?? 60 * 60_000);
// Claude in Chrome (needs the extension connected in the owner's Chrome).
// CLAUDE_BRIDGE_CHROME=0 turns it off.
const CHROME = process.env.CLAUDE_BRIDGE_CHROME !== "0";
const PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude/projects");
const STATE_FILE =
  process.env.CLAUDE_BRIDGE_STATE ?? join(homedir(), ".local/state/netcam-claude-bridge/sessions.json");
const SYSTEM_PROMPT =
  process.env.CLAUDE_BRIDGE_SYSTEM_PROMPT ??
  "You are being driven over WhatsApp by the owner of this PC. Nobody is watching the terminal, so never wait for " +
    "interactive input. Keep replies short and plain text (WhatsApp shows no markdown tables or headings). " +
    "You run as the owner on their own PC: the shell, their files, SSH to their servers and the desktop " +
    "(DISPLAY/WAYLAND are set) are available, and their Chrome is when the Claude extension is connected. " +
    "Ask the owner first before anything destructive or hard to undo, and before anything that could cut NetCam " +
    "customers off the internet (this PC is their gateway). The owner's projects are folders in ~ and ~/projects.";

if (!SECRET) {
  console.error("CLAUDE_BRIDGE_SECRET is not set; refusing to start.");
  process.exit(1);
}

const label = (engine) => (engine === "codex" ? "Codex" : "Claude");

// Per WhatsApp conversation: the engine, the folder it works in and the session to
// resume there. Older state files stored just the session id.
function loadSessions() {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string") raw[k] = { cwd: CWD, sessionId: v };
    return raw;
  } catch {
    return {};
  }
}
const sessions = loadSessions();
function saveSessions() {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(sessions, null, 2));
}

function convo(id) {
  return (sessions[id] ??= { cwd: CWD });
}

function assistantText(entry) {
  if (entry?.message?.role !== "assistant" || !Array.isArray(entry.message.content)) return "";
  return entry.message.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text.trim())
    .filter((value) => value && value !== "No response requested.")
    .join("\n\n");
}

/**
 * Claude writes assistant messages to its JSONL transcript before the CLI
 * prints the final JSON response. If the wrapper is terminated (commonly exit
 * 143), recover the real text produced during this turn instead of exposing a
 * process error to WhatsApp.
 */
function recoverClaudeReply(cwd, sessionId, startedAt) {
  const dir = join(PROJECTS_DIR, projectKey(cwd));
  const candidates = sessionId
    ? [join(dir, `${sessionId}.jsonl`)]
    : sessionFiles(dir)
        .filter((file) => statSync(file).mtimeMs >= startedAt - 5_000)
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    let entries;
    try {
      entries = jsonLines(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const replies = entries.flatMap((entry) => {
      const timestamp = Date.parse(entry?.timestamp ?? "");
      const value = assistantText(entry);
      return value && Number.isFinite(timestamp) && timestamp >= startedAt - 2_000 ? [value] : [];
    });
    if (replies.length) return { text: replies.at(-1), sessionId: basename(file, ".jsonl") };
  }
  return null;
}

function runClaude(prompt, cwd, sessionId) {
  const args = ["-p", prompt, "--output-format", "json", "--dangerously-skip-permissions"];
  if (CHROME) args.push("--chrome");
  args.push("--append-system-prompt", SYSTEM_PROMPT);
  if (sessionId) args.push("--resume", sessionId);
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(CLAUDE_BIN, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let timedOut = false;
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out);
        return resolve({ ok: !r.is_error, text: String(r.result ?? ""), sessionId: r.session_id, error: r.is_error ? r.result : undefined });
      } catch {
        const recovered = recoverClaudeReply(cwd, sessionId, startedAt);
        if (recovered) return resolve({ ok: true, text: recovered.text, sessionId: recovered.sessionId, recovered: true });
        const stopped = timedOut || signal || code === 143 || code === 137;
        resolve({
          ok: false,
          error: stopped
            ? `Claude stopped before it produced a text reply. Send “continue” to resume the same session.`
            : (err || out || `Claude could not complete this turn (exit ${code ?? "unknown"}).`).trim().slice(-500),
        });
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    });
  });
}

// Codex has no --append-system-prompt, so new sessions get the WhatsApp
// instructions in front of the first message.
function runCodex(prompt, cwd, sessionId) {
  const flags = ["--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"];
  const args = sessionId
    ? ["exec", "resume", sessionId, ...flags, "--", prompt]
    : ["exec", ...flags, "--", `${SYSTEM_PROMPT.replace(/Claude extension/g, "browser extension")}\n\n${prompt}`];
  return new Promise((resolve) => {
    const child = spawn(CODEX_BIN, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) return resolve({ ok: false, error: `Codex was stopped after ${Math.round(TIMEOUT_MS / 60_000)} minutes.` });
      let id = sessionId;
      const replies = [];
      let failure;
      for (const e of jsonLines(out)) {
        if (e.type === "thread.started") id = e.thread_id;
        else if (e.type === "item.completed" && e.item?.type === "agent_message") replies.push(e.item.text);
        else if (e.type === "turn.failed") failure = e.error?.message ?? "turn failed";
        else if (e.type === "error") failure = e.message;
      }
      if (replies.length) return resolve({ ok: true, text: replies.at(-1), sessionId: id });
      resolve({ ok: false, sessionId: id, error: (failure || err || out || `codex exited with code ${code}`).trim().slice(-500) });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    });
  });
}

// One Claude/Codex run at a time per conversation, in arrival order.
const queues = new Map();
function enqueue(key, job) {
  const next = (queues.get(key) ?? Promise.resolve()).then(job, job);
  queues.set(key, next.catch(() => {}));
  return next;
}

// Signing Claude in from WhatsApp: "login" starts `claude auth login` and
// replies with its sign-in link; "code <value>" pastes the code the sign-in
// page shows into that waiting process.
let pendingLogin = null;

function startLogin() {
  pendingLogin?.child.kill();
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, ["auth", "login"], {
      cwd: CWD,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, BROWSER: "true" },
    });
    const login = { child, output: "", done: null };
    pendingLogin = login;
    login.done = new Promise((res) => child.on("close", (code) => res(code)));
    login.done.then(() => pendingLogin === login && (pendingLogin = null));
    const onData = (d) => {
      login.output += d;
      const url = login.output.match(/https:\/\/\S+/);
      if (url) resolve(`Open this link, sign in, then send me: code <the code it shows>\n\n${url[0]}`);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    setTimeout(() => resolve(`Couldn't get a sign-in link:\n${login.output.slice(0, 500)}`), 30_000);
    setTimeout(() => child.kill(), 15 * 60_000);
  });
}

async function finishLogin(code) {
  const login = pendingLogin;
  if (!login) return "No sign-in is waiting. Send: login";
  login.child.stdin.write(`${code}\n`);
  const exit = await Promise.race([login.done, new Promise((r) => setTimeout(() => r("timeout"), 60_000))]);
  if (exit === 0) return "Claude is signed in. Send your request.";
  const tail = login.output.split("\n").filter(Boolean).slice(-3).join("\n");
  return `Sign-in didn't finish (${exit}). ${tail}\nSend: login to try again.`;
}

// ---- Projects and sessions, read from Claude's own store ----------------
// Claude keeps each session as <PROJECTS_DIR>/<cwd with non-alphanumerics
// as "-">/<sessionId>.jsonl. The real folder is the "cwd" field inside.

const projectKey = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

function readSlice(file, fromEnd, bytes = 64_000) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, fromEnd ? size - len : 0);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function jsonLines(text) {
  return text.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function promptText(entry) {
  const c = entry?.message?.content;
  const t = typeof c === "string" ? c : Array.isArray(c) ? c.find((p) => p?.type === "text")?.text : "";
  return (t ?? "").replace(/\s+/g, " ").trim();
}

function sessionInfo(file) {
  const head = jsonLines(readSlice(file, false));
  const tail = jsonLines(readSlice(file, true));
  const all = [...head, ...tail];
  const cwd = all.find((e) => typeof e.cwd === "string")?.cwd;
  const title =
    [...tail].reverse().find((e) => e.type === "custom-title")?.customTitle ??
    [...tail].reverse().find((e) => e.type === "ai-title")?.aiTitle ??
    head.map((e) => (e.type === "user" ? promptText(e) : "")).find((t) => t && !t.startsWith("<")) ??
    [...tail].reverse().find((e) => e.type === "last-prompt")?.lastPrompt ??
    "(untitled)";
  return { id: basename(file, ".jsonl"), cwd, title: String(title), mtime: statSync(file).mtimeMs };
}

function sessionFiles(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function claudeProjects() {
  let dirs = [];
  try {
    dirs = readdirSync(PROJECTS_DIR).filter((d) => !/scratch-workspaces|^-tmp/.test(d));
  } catch {}
  const out = [];
  for (const d of dirs) {
    const files = sessionFiles(join(PROJECTS_DIR, d))
      .map((f) => ({ f, m: statSync(f).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (!files.length) continue;
    const cwd = sessionInfo(files[0].f).cwd;
    if (cwd && existsSync(cwd)) out.push({ cwd, mtime: files[0].m, sessions: files.length });
  }
  return out;
}

// Any folder directly under these roots that looks like a project.
const PROJECT_MARKERS = [".git", "package.json", "pubspec.yaml", "pyproject.toml", "requirements.txt", "composer.json",
  "go.mod", "Cargo.toml", "wrangler.toml", "docker-compose.yml", "index.html", "build.gradle", "CLAUDE.md"];
const SCAN_ROOTS = (process.env.CLAUDE_PROJECT_ROOTS ?? "~,~/projects,~/AndroidStudioProjects,~/Desktop,~/Documents")
  .split(",")
  .map((r) => r.trim().replace(/^~(?=$|\/)/, homedir()));
const SKIP = new Set(["node_modules", "snap", "Android", "flutter"]);

function folderProjects() {
  const out = [];
  for (const root of SCAN_ROOTS) {
    let entries = [];
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP.has(e.name)) continue;
      const dir = join(root, e.name);
      if (!PROJECT_MARKERS.some((m) => existsSync(join(dir, m)))) continue;
      try {
        out.push({ cwd: dir, mtime: statSync(dir).mtimeMs, sessions: 0 });
      } catch {}
    }
  }
  return out;
}

// Folders Claude has worked in first (most recent first), then every other
// project folder on the PC.
function listProjects() {
  const seen = new Map();
  const byRecent = (a, b) => b.mtime - a.mtime;
  for (const p of [...claudeProjects().sort(byRecent), ...folderProjects().sort(byRecent)]) {
    if (p.cwd !== homedir() && !seen.has(p.cwd)) seen.set(p.cwd, p);
  }
  return [...seen.values()];
}

function findProject(name) {
  const q = name.toLowerCase();
  const all = listProjects();
  const base = (p) => basename(p.cwd).toLowerCase();
  return all.find((p) => base(p) === q) ?? all.find((p) => base(p).startsWith(q)) ?? all.find((p) => base(p).includes(q));
}

function listSessions(cwd) {
  return sessionFiles(join(PROJECTS_DIR, projectKey(cwd)))
    .map((f) => {
      try {
        return sessionInfo(f);
      } catch {
        return null;
      }
    })
    .filter((s) => s && s.title !== "(untitled)")
    .sort((a, b) => b.mtime - a.mtime);
}

const short = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const tilde = (p) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 60) return `${Math.max(m, 1)}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

// Codex keeps sessions as <CODEX_HOME>/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl;
// the first line holds the cwd, session_index.jsonl the titles.
function listCodexSessions(cwd) {
  const titles = new Map();
  try {
    for (const e of jsonLines(readFileSync(join(CODEX_HOME, "session_index.jsonl"), "utf8"))) titles.set(e.id, e.thread_name);
  } catch {}
  const files = [];
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const f = join(dir, e.name);
      if (e.isDirectory() && depth < 3) walk(f, depth + 1);
      else if (e.name.endsWith(".jsonl")) files.push({ f, mtime: statSync(f).mtimeMs });
    }
  };
  walk(join(CODEX_HOME, "sessions"), 0);
  return files
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 300)
    .flatMap(({ f, mtime }) => {
      const head = readSlice(f, false, 4000);
      const id = head.match(/"id":"([^"]+)"/)?.[1];
      const dir = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1];
      if (!id || dir !== cwd) return [];
      return [{ id, cwd, title: String(titles.get(id) ?? `Codex chat ${new Date(mtime - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16).replace("T", " ")}`), mtime }];
    });
}

const sessionsFor = (c) => (c.engine === "codex" ? listCodexSessions(c.cwd) : listSessions(c.cwd));

// ---- WhatsApp messages (the hub's "buttons" / "list" payloads) -----------
// Limits: 3 buttons (20 chars), 10 list rows (title 24, description 72).

const text = (message) => ({ type: "text", message });

function mainMenu(id, intro) {
  const c = convo(id);
  return {
    type: "buttons",
    body:
      `${intro ? `${intro}\n\n` : ""}${label(c.engine)} on the PC\nProject: ${tilde(c.cwd)}\n` +
      `Session: ${c.sessionId ? "continuing the last one" : "new"}\n\n` +
      `Type a request any time. Send *${c.engine === "codex" ? "codex" : "claude"}* to come back here.\n` +
      "(Don't send \"menu\" or \"apps\": the shared number uses those to switch apps.)",
    buttons: [
      { id: "m:projects", title: "Projects" },
      { id: "m:sessions", title: "Sessions" },
      { id: "m:new", title: "New session" },
    ],
  };
}

// A list holds 10 rows: 9 items plus "More…" / "Back".
const PAGE = 9;

function pager(kind, page, total, perPage) {
  if (total > (page + 1) * perPage) {
    return [{ id: `m:${kind}:${page + 1}`, title: `More ${kind}…`, description: `Page ${page + 2} of ${Math.ceil(total / perPage)}` }];
  }
  return page > 0 ? [{ id: `m:${kind}:0`, title: "Back to first page" }] : [];
}

function projectsMenu(id, page = 0) {
  const current = convo(id).cwd;
  const all = [{ cwd: homedir() }, ...listProjects()];
  const rows = all.slice(page * PAGE, (page + 1) * PAGE).map((p) => ({
    id: `p:${p.cwd}`.slice(0, 200),
    title: short(p.cwd === homedir() ? "Home folder" : basename(p.cwd), 24),
    description: short(
      [p.cwd === current ? "✓" : "", tilde(p.cwd), p.sessions ? `${p.sessions} chats, ${ago(p.mtime)}` : ""]
        .filter(Boolean)
        .join(" · "),
      72,
    ),
  }));
  return {
    type: "list",
    body:
      `${all.length} projects. Pick the folder ${label(convo(id).engine)} should work in. Now: ${tilde(current)}\n\n` +
      "Or type: cd umall (any project name) or cd ~/any/folder",
    buttonText: "Projects",
    sections: [{ title: page ? `Projects, page ${page + 1}` : "Projects", rows: [...rows, ...pager("projects", page, all.length, PAGE)] }],
  };
}

function sessionsMenu(id, page = 0) {
  const c = convo(id);
  const all = sessionsFor(c);
  // 8 per page: the first row is always "New session".
  const list = all.slice(page * 8, (page + 1) * 8);
  return {
    type: "list",
    body: list.length
      ? `Sessions in ${tilde(c.cwd)}. Pick one to continue it.`
      : `No earlier sessions in ${tilde(c.cwd)} yet. Start a new one, or pick another project.`,
    buttonText: "Sessions",
    sections: [
      {
        title: "Sessions",
        rows: [
          { id: "m:new", title: "➕ New session", description: "Start fresh in this project" },
          ...list.map((s) => ({
            id: `s:${s.id}`,
            title: short(s.title, 24),
            description: short(`${s.id === c.sessionId ? "✓ current · " : ""}${ago(s.mtime)} · ${s.title}`, 72),
          })),
          ...pager("sessions", page, all.length, 8),
        ],
      },
    ],
  };
}

function setProject(id, path) {
  // A bare name ("umall") picks the matching project; anything else is a path.
  const named = /[/~]/.test(path) ? null : findProject(path);
  const cwd = named ? named.cwd : resolvePath(CWD, path.replace(/^~(?=$|\/)/, homedir()));
  try {
    if (!statSync(cwd).isDirectory()) throw new Error();
  } catch {
    return [text(`${tilde(cwd)} isn't a folder on the PC.`)];
  }
  sessions[id] = { cwd, engine: convo(id).engine };
  saveSessions();
  return [mainMenu(id, `Switched to ${tilde(cwd)}. Your next message starts a new session there.`)];
}

function setSession(id, sessionId) {
  const c = convo(id);
  const s = sessionsFor(c).find((x) => x.id === sessionId);
  if (!s) return [text("That session is no longer there."), sessionsMenu(id)];
  c.sessionId = s.id;
  saveSessions();
  return [text(`Continuing "${short(s.title, 60)}" (${ago(s.mtime)}). Send your next request.`)];
}

/** Menu commands and taps. Returns messages, or null when it's a request for the agent. */
async function command(id, input, choice) {
  const key = choice ?? input.toLowerCase().replace(/^\//, "");
  // "menu", "apps" and "support" never get here: the WhatsApp hub keeps those
  // for its own app picker.
  if (key === "m:menu" || /^(claude|codex|help|start|options|hi|hello)$/.test(key)) return [mainMenu(id)];
  const paged = choice?.match(/^m:(projects|sessions):(\d+)$/);
  if (paged) return [paged[1] === "projects" ? projectsMenu(id, Number(paged[2])) : sessionsMenu(id, Number(paged[2]))];
  if (key === "m:projects" || /^(projects?|folders?)$/.test(key)) return [projectsMenu(id)];
  if (key === "m:sessions" || /^(sessions?|history|chats?)$/.test(key)) return [sessionsMenu(id)];
  if (key === "m:new" || /^(new|reset|clear)$/.test(key)) {
    delete convo(id).sessionId;
    saveSessions();
    return [text(`Started a fresh ${label(convo(id).engine)} session in ${tilde(convo(id).cwd)}. Send your request.`)];
  }
  if (key === "status" || key === "where") return [mainMenu(id)];
  if (choice?.startsWith("p:")) return setProject(id, choice.slice(2));
  if (choice?.startsWith("s:")) return setSession(id, choice.slice(2));
  const cd = input.match(/^\/?cd\s+(.+)$/i);
  if (cd) return setProject(id, cd[1].trim());
  if (/^\/?login$/i.test(input) && convo(id).engine === "codex") {
    return [text("Codex uses the ChatGPT sign-in saved on the PC (run `codex login` there if it expires).")];
  }
  if (/^\/?login$/i.test(input)) return [text(await startLogin())];
  const code = input.match(/^\/?code\s+(\S+)$/i);
  if (code) return [text(await finishLogin(code[1]))];
  return null;
}

async function handle(id, input, choice, engine) {
  const trimmed = input.trim();
  const c0 = convo(id);
  if (c0.engine !== engine) {
    // Switching engines: a session id from the other one can't be resumed.
    if (c0.engine || engine === "codex") delete c0.sessionId;
    c0.engine = engine;
    saveSessions();
  }
  const menu = await command(id, trimmed, choice);
  if (menu) return menu;

  const c = convo(id);
  const run = engine === "codex" ? runCodex : runClaude;
  let r = await run(trimmed, c.cwd, c.sessionId);
  if (!r.ok && c.sessionId && /no conversation found|session|thread|not found/i.test(r.error ?? "")) {
    // Saved session is gone (e.g. cleaned up); start over rather than fail forever.
    delete c.sessionId;
    r = await run(trimmed, c.cwd);
  }
  if (r.sessionId) {
    c.sessionId = r.sessionId;
    saveSessions();
  }
  return [text(r.ok ? r.text || "(done, no text reply)" : `${label(engine)} error: ${r.error}`)];
}

function authorized(req) {
  const given = Buffer.from(String(req.headers["x-bridge-secret"] ?? ""));
  const expected = Buffer.from(SECRET);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/run") return send(res, 404, { error: "not found" });
  if (!authorized(req)) return send(res, 401, { error: "unauthorized" });

  let raw = "";
  req.on("data", (d) => {
    raw += d;
    if (raw.length > 64_000) req.destroy();
  });
  req.on("end", async () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: "invalid json" });
    }
    const { conversationId, text: input, choice } = body ?? {};
    const engine = body?.engine === "codex" ? "codex" : "claude";
    const pick = typeof choice === "string" && choice ? choice : undefined;
    if (typeof conversationId !== "string" || typeof input !== "string" || (!input.trim() && !pick)) {
      return send(res, 400, { error: "conversationId and text are required" });
    }
    const messages = await enqueue(conversationId, () => handle(conversationId, input, pick, engine));
    // `reply` keeps older API builds working: all text joined.
    const reply = messages.map((m) => m.message ?? m.body).join("\n\n");
    send(res, 200, { reply, messages });
  });
}).listen(PORT, HOST, () => console.log(`claude-bridge listening on ${HOST}:${PORT}, cwd ${CWD}`));
