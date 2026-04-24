import express from "express";
import cors from "cors";
import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";
import { spawn, exec } from "child_process";
import { fileURLToPath } from "url";
import { glob } from "glob";
import dotenv from "dotenv";

// When running as packaged exe, load .env from next to the executable
const _exeDir = process.env.CAXA_ORIGINAL_ARGV0
  ? path.dirname(process.env.CAXA_ORIGINAL_ARGV0)
  : null;
dotenv.config({ path: _exeDir ? path.join(_exeDir, ".env") : ".env" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_PATH = path.join(__dirname, "dist");
const IS_PACKAGED = Boolean(process.env.CAXA_ORIGINAL_ARGV0);
const EXE_DIR = IS_PACKAGED ? path.dirname(process.env.CAXA_ORIGINAL_ARGV0) : ".";

// Keep crash visible when running as packaged exe
if (IS_PACKAGED) {
  process.on("uncaughtException", (err) => {
    fsSync.writeFileSync(path.join(EXE_DIR, "hermes-error.log"),
      `${new Date().toISOString()}\n${err.stack}\n`);
    process.exit(1);
  });
}

const PORT = parseInt(process.env.PORT || "8787", 10);
const VAULT_PATH = process.env.VAULT_PATH ? path.resolve(process.env.VAULT_PATH) : null;
const MODEL = process.env.MODEL || readCodexDefaultModel() || "gpt-5.4";
const DEFAULT_SYSTEM =
  "You are Hermes, a persistent AI agent rooted in the user's Obsidian vault. " +
  "Be direct, useful, and only save notes when it truly helps the user.";

const SOURCE_CODEX_HOME = path.join(os.homedir(), ".codex");
const SOURCE_CODEX_AUTH = path.join(SOURCE_CODEX_HOME, "auth.json");
const RUNTIME_ROOT = path.join(os.tmpdir(), "hermes-brain-codex");
const RUNTIME_CODEX_HOME = path.join(RUNTIME_ROOT, "home");
const RUNTIME_CODEX_BIN = path.join(RUNTIME_ROOT, "bin");
const RUNTIME_CODEX_EXE = path.join(RUNTIME_CODEX_BIN, "codex.exe");
const TOOL_NAMES = ["list_vault", "read_file", "write_file", "append_file", "search_vault"];

if (!VAULT_PATH) {
  console.warn("VAULT_PATH is not set. Configure it in .env before using Hermes Brain.");
}

function readCodexDefaultModel() {
  try {
    const raw = fsSync.readFileSync(path.join(SOURCE_CODEX_HOME, "config.toml"), "utf8");
    const match = raw.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findCodexSourceExecutable() {
  const windowsApps = path.join(process.env.ProgramFiles || "C:\\Program Files", "WindowsApps");
  const entries = await fs.readdir(windowsApps, { withFileTypes: true }).catch(() => []);
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("OpenAI.Codex_")) {
      continue;
    }
    const candidate = path.join(windowsApps, entry.name, "app", "resources", "codex.exe");
    if (await exists(candidate)) {
      candidates.push(candidate);
    }
  }

  candidates.sort((left, right) =>
    right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }),
  );

  return candidates[0] || null;
}

async function ensureCodexExecutable() {
  const source = await findCodexSourceExecutable();
  if (!source) {
    throw new Error("Codex Desktop CLI was not found. Install or open Codex Desktop first.");
  }

  await fs.mkdir(RUNTIME_CODEX_BIN, { recursive: true });

  const sourceStat = await fs.stat(source);
  const targetExists = await exists(RUNTIME_CODEX_EXE);

  if (!targetExists) {
    await fs.copyFile(source, RUNTIME_CODEX_EXE);
    return RUNTIME_CODEX_EXE;
  }

  const targetStat = await fs.stat(RUNTIME_CODEX_EXE);
  if (
    targetStat.size !== sourceStat.size ||
    Math.abs(targetStat.mtimeMs - sourceStat.mtimeMs) > 1000
  ) {
    await fs.copyFile(source, RUNTIME_CODEX_EXE);
  }

  return RUNTIME_CODEX_EXE;
}

function readCodexAuthSummary() {
  try {
    const raw = fsSync.readFileSync(SOURCE_CODEX_AUTH, "utf8");
    const parsed = JSON.parse(raw);
    const tokens = parsed?.tokens || {};
    return {
      ok: Boolean(tokens.access_token || tokens.refresh_token),
      accountId: tokens.account_id || null,
      authMode: parsed?.auth_mode || null,
    };
  } catch {
    return { ok: false, accountId: null, authMode: null };
  }
}

async function syncCodexAuthIntoRuntime() {
  if (!(await exists(SOURCE_CODEX_AUTH))) {
    throw new Error("Codex auth was not found. Sign in to Codex Desktop first.");
  }

  await fs.mkdir(RUNTIME_CODEX_HOME, { recursive: true });
  await fs.mkdir(path.join(RUNTIME_CODEX_HOME, "skills"), { recursive: true });
  await fs.mkdir(path.join(RUNTIME_CODEX_HOME, "sessions"), { recursive: true });
  await fs.copyFile(SOURCE_CODEX_AUTH, path.join(RUNTIME_CODEX_HOME, "auth.json"));
  await fs.writeFile(path.join(RUNTIME_CODEX_HOME, "config.toml"), `model = ${JSON.stringify(MODEL)}\n`, "utf8");
}

async function syncCodexAuthBackToSource() {
  const runtimeAuth = path.join(RUNTIME_CODEX_HOME, "auth.json");
  if (!(await exists(runtimeAuth))) {
    return;
  }

  try {
    const runtimeRaw = await fs.readFile(runtimeAuth, "utf8");
    JSON.parse(runtimeRaw);
    const sourceRaw = (await exists(SOURCE_CODEX_AUTH))
      ? await fs.readFile(SOURCE_CODEX_AUTH, "utf8")
      : "";

    if (runtimeRaw !== sourceRaw) {
      await fs.copyFile(runtimeAuth, SOURCE_CODEX_AUTH);
    }
  } catch {
    // Ignore sync-back failures and keep the original auth file untouched.
  }
}

function buildPlannerSchema() {
  return {
    type: "object",
    properties: {
      reply: { type: "string" },
      tool_request: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            properties: {
              name: { type: "string", enum: ["list_vault"] },
              input: {
                type: "object",
                properties: {
                  pattern: { type: "string" },
                },
                required: ["pattern"],
                additionalProperties: false,
              },
            },
            required: ["name", "input"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              name: { type: "string", enum: ["read_file"] },
              input: {
                type: "object",
                properties: {
                  path: { type: "string" },
                },
                required: ["path"],
                additionalProperties: false,
              },
            },
            required: ["name", "input"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              name: { type: "string", enum: ["write_file"] },
              input: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  content: { type: "string" },
                },
                required: ["path", "content"],
                additionalProperties: false,
              },
            },
            required: ["name", "input"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              name: { type: "string", enum: ["append_file"] },
              input: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  content: { type: "string" },
                },
                required: ["path", "content"],
                additionalProperties: false,
              },
            },
            required: ["name", "input"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              name: { type: "string", enum: ["search_vault"] },
              input: {
                type: "object",
                properties: {
                  query: { type: "string" },
                },
                required: ["query"],
                additionalProperties: false,
              },
            },
            required: ["name", "input"],
            additionalProperties: false,
          },
        ],
      },
    },
    required: ["reply", "tool_request"],
    additionalProperties: false,
  };
}

function safePath(rel) {
  if (!VAULT_PATH) {
    throw new Error("VAULT_PATH is not configured.");
  }
  if (!rel || typeof rel !== "string") {
    throw new Error("Invalid path argument.");
  }

  const normalized = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = path.resolve(VAULT_PATH, normalized);
  if (!abs.startsWith(VAULT_PATH + path.sep) && abs !== VAULT_PATH) {
    throw new Error("Path escapes the vault root.");
  }
  return abs;
}

async function execTool(name, input) {
  switch (name) {
    case "list_vault": {
      if (!VAULT_PATH) {
        throw new Error("VAULT_PATH is not configured.");
      }
      const pattern = input.pattern || "**/*.md";
      const files = await glob(pattern, { cwd: VAULT_PATH, nodir: true, posix: true });
      return { files: files.slice(0, 500), total: files.length };
    }
    case "read_file": {
      const abs = safePath(input.path);
      const content = await fs.readFile(abs, "utf8");
      return { path: input.path, content };
    }
    case "write_file": {
      const abs = safePath(input.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, input.content, "utf8");
      return { ok: true, path: input.path, bytes: Buffer.byteLength(input.content, "utf8") };
    }
    case "append_file": {
      const abs = safePath(input.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      const prefix = (await fs.stat(abs).catch(() => null)) ? "\n\n" : "";
      await fs.appendFile(abs, prefix + input.content, "utf8");
      return { ok: true, path: input.path };
    }
    case "search_vault": {
      if (!VAULT_PATH) {
        throw new Error("VAULT_PATH is not configured.");
      }
      const query = String(input.query || "").trim().toLowerCase();
      if (!query) {
        throw new Error("search_vault requires a non-empty query.");
      }

      const files = await glob("**/*.md", { cwd: VAULT_PATH, nodir: true, posix: true });
      const hits = [];

      for (const file of files) {
        try {
          const content = await fs.readFile(path.join(VAULT_PATH, file), "utf8");
          const idx = content.toLowerCase().indexOf(query);
          if (idx === -1) {
            continue;
          }

          hits.push({
            file,
            snippet: content
              .slice(Math.max(0, idx - 80), idx + 180)
              .replace(/\s+/g, " ")
              .trim(),
          });

          if (hits.length >= 20) {
            break;
          }
        } catch {
          // Skip unreadable files.
        }
      }

      return { hits };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function summarizeResult(name, result) {
  if (name === "list_vault") {
    return `${result.total} markdown files`;
  }
  if (name === "read_file") {
    return `${result.path} · ${result.content?.length || 0} chars`;
  }
  if (name === "write_file") {
    return `${result.path} · ${result.bytes} bytes`;
  }
  if (name === "append_file") {
    return `Appended to ${result.path}`;
  }
  if (name === "search_vault") {
    return `${result.hits.length} hit(s)`;
  }
  return "Done";
}

function truncateText(text, limit = 12000) {
  const value = typeof text === "string" ? text : JSON.stringify(text);
  if (!value || value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]`;
}

function renderPlannerHistory(history) {
  if (!history.length) {
    return "(empty)";
  }

  return history
    .map((entry, index) => {
      if (entry.kind === "message") {
        const label = entry.role === "assistant" ? "ASSISTANT" : "USER";
        return `${index + 1}. ${label}\n${truncateText(entry.content, 8000)}`;
      }

      const status = entry.error ? "ERROR" : "OK";
      const result = entry.error
        ? entry.error
        : truncateText(JSON.stringify(entry.result, null, 2), 12000);
      return [
        `${index + 1}. TOOL ${entry.name} [${status}]`,
        `input: ${JSON.stringify(entry.input)}`,
        `result: ${result}`,
      ].join("\n");
    })
    .join("\n\n");
}

function buildPlannerPrompt(system, history) {
  return [
    "You are Hermes, a Chinese-first AI note assistant backed by a local Obsidian vault.",
    "Do not use shell commands, web search, MCP, or any hidden local context.",
    "Only reason from the system prompt, the conversation transcript, and the tool results provided below.",
    "Return plain user-facing text in reply. Never put JSON, code fences, or markdown tables inside reply unless the user explicitly asks.",
    "Request at most one tool call per turn.",
    "Use search_vault before read_file when you do not know the exact file path.",
    "Only use write_file or append_file when the user asks to save or update notes, or when the system prompt clearly calls for persistence.",
    "",
    "Available tools:",
    '- list_vault { pattern: string }  (use "**/*.md" when you need the full vault)',
    "- read_file { path: string }",
    "- write_file { path: string, content: string }",
    "- append_file { path: string, content: string }",
    "- search_vault { query: string }",
    "",
    "System prompt:",
    system || DEFAULT_SYSTEM,
    "",
    "Conversation transcript:",
    renderPlannerHistory(history),
    "",
    "Decide whether you need one tool call.",
    "- If yes, set tool_request to the exact tool input required and keep reply to one short progress sentence.",
    "- If no, set tool_request to null and give the final answer in reply.",
  ].join("\n");
}

function normalizeIncomingMessages(messages) {
  return messages.map((message) => ({
    kind: "message",
    role: message.role === "hermes" ? "assistant" : message.role,
    content: String(message.content || ""),
  }));
}

function parseJsonLines(output) {
  const events = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Ignore non-JSON log lines.
    }
  }
  return events;
}

function pickCodexUsage(events) {
  const turnCompleted = [...events].reverse().find((event) => event.type === "turn.completed");
  return turnCompleted?.usage || null;
}

function extractCodexError(stdout, stderr, exitCode) {
  const combined = `${stdout || ""}\n${stderr || ""}`.trim();
  const messageMatch = combined.match(/"message":\s*"([^"]+)"/);
  if (messageMatch?.[1]) {
    return messageMatch[1];
  }

  const relevantLines = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8);

  if (relevantLines.length) {
    return relevantLines.join(" | ");
  }
  return `Codex CLI exited with code ${exitCode}.`;
}

function spawnCollect(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs || 180000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error("Codex CLI timed out."));
        return;
      }
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function runCodexPlanner(prompt) {
  await ensureCodexExecutable();
  await syncCodexAuthIntoRuntime();

  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-brain-run-"));
  const schemaPath = path.join(runDir, "planner-schema.json");
  const outputPath = path.join(runDir, "planner-output.json");

  try {
    await fs.writeFile(schemaPath, JSON.stringify(buildPlannerSchema(), null, 2), "utf8");

    const { code, stdout, stderr } = await spawnCollect(
      RUNTIME_CODEX_EXE,
      [
        "-a",
        "never",
        "exec",
        "--json",
        "--ephemeral",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "-C",
        runDir,
        "--output-schema",
        schemaPath,
        "-o",
        outputPath,
        prompt,
      ],
      {
        cwd: runDir,
        env: {
          ...process.env,
          CODEX_HOME: RUNTIME_CODEX_HOME,
        },
      },
    );

    const parsedEvents = parseJsonLines(stdout);
    const usage = pickCodexUsage(parsedEvents);

    let raw = "";
    if (await exists(outputPath)) {
      raw = await fs.readFile(outputPath, "utf8");
    }

    if (!raw.trim()) {
      const agentMessage = [...parsedEvents]
        .reverse()
        .find((event) => event.type === "item.completed" && event.item?.type === "agent_message");
      raw = String(agentMessage?.item?.text || "");
    }

    if (code !== 0 && !raw.trim()) {
      throw new Error(extractCodexError(stdout, stderr, code));
    }

    if (!raw.trim()) {
      throw new Error("Codex returned an empty response.");
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Codex returned invalid JSON: ${truncateText(raw, 400)}`);
    }

    return { parsed, usage };
  } finally {
    await syncCodexAuthBackToSource();
    await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runHermesChat(messages, system) {
  const history = normalizeIncomingMessages(messages);
  const events = [];
  let usage = null;

  for (let round = 0; round < 8; round += 1) {
    const prompt = buildPlannerPrompt(system, history);
    const { parsed, usage: runUsage } = await runCodexPlanner(prompt);
    usage = runUsage || usage;

    const reply = String(parsed?.reply || "").trim();
    const toolRequest = parsed?.tool_request;

    if (!toolRequest) {
      return {
        text: reply || "我已经完成这一步了，但没有生成可展示的回复。",
        events,
        usage,
        stop_reason: "completed",
      };
    }

    const name = String(toolRequest.name || "");
    const input = toolRequest.input || {};

    if (!TOOL_NAMES.includes(name)) {
      throw new Error(`Codex requested an unsupported tool: ${name}`);
    }

    if (reply) {
      history.push({ kind: "message", role: "assistant", content: reply });
    }

    events.push({ type: "tool_call", name, input });

    try {
      const result = await execTool(name, input);
      history.push({ kind: "tool", name, input, result, error: null });
      events.push({ type: "tool_ok", name, summary: summarizeResult(name, result) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      history.push({ kind: "tool", name, input, result: null, error: message });
      events.push({ type: "tool_error", name, error: message });
    }
  }

  return {
    text: "我已经执行了多轮检索，但这次对话还没有稳定收敛。你可以把问题再收窄一点，我继续查。",
    events,
    usage,
    stop_reason: "max_rounds",
  };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/api/config", async (req, res) => {
  const auth = readCodexAuthSummary();
  let hasExecutable = false;

  try {
    hasExecutable = Boolean(await ensureCodexExecutable());
  } catch {
    hasExecutable = false;
  }

  res.json({
    hasApiKey: auth.ok && hasExecutable,
    hasCodexAuth: auth.ok && hasExecutable,
    authMode: auth.authMode || "chatgpt",
    vaultPath: VAULT_PATH,
    vaultName: VAULT_PATH ? path.basename(VAULT_PATH) : null,
    model: MODEL,
    accountIdPresent: Boolean(auth.accountId),
  });
});

app.get("/api/vault/tree", async (req, res) => {
  try {
    if (!VAULT_PATH) {
      throw new Error("VAULT_PATH is not configured.");
    }
    const files = await glob("**/*.md", { cwd: VAULT_PATH, nodir: true, posix: true });
    res.json({ files, total: files.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/vault/file", async (req, res) => {
  try {
    const content = await fs.readFile(safePath(req.query.path), "utf8");
    res.json({ path: req.query.path, content });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.put("/api/vault/file", async (req, res) => {
  try {
    const abs = safePath(req.body.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, req.body.content || "", "utf8");
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/chat", async (req, res) => {
  const { messages, system } = req.body;
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages must be an array." });
  }
  if (!VAULT_PATH) {
    return res.status(400).json({ error: "VAULT_PATH is not configured." });
  }

  const auth = readCodexAuthSummary();
  if (!auth.ok) {
    return res.status(400).json({ error: "Codex Desktop is not signed in on this machine." });
  }

  try {
    const result = await runHermesChat(messages, system || DEFAULT_SYSTEM);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

// Serve built frontend (production / packaged mode)
if (fsSync.existsSync(DIST_PATH)) {
  app.use(express.static(DIST_PATH));
  app.get("*", (req, res) => res.sendFile(path.join(DIST_PATH, "index.html")));
}

app.listen(PORT, async () => {
  const auth = readCodexAuthSummary();
  let executableStatus = "missing";
  try {
    await ensureCodexExecutable();
    executableStatus = "ready";
  } catch {
    executableStatus = "missing";
  }

  console.log("\nHermes Brain backend");
  console.log(`- http://localhost:${PORT}`);
  console.log(`- Vault: ${VAULT_PATH || "<not configured>"}`);
  console.log(`- Model: ${MODEL}`);
  console.log(`- Codex auth: ${auth.ok ? "ready" : "missing"}`);
  console.log(`- Codex CLI: ${executableStatus}\n`);

  if (fsSync.existsSync(DIST_PATH)) {
    setTimeout(() => exec(`start http://localhost:${PORT}`), 1000);
  }
});
