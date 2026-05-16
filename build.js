#!/usr/bin/env node

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

// ─── config ────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 15 * 60 * 1000;
const TSCONFIG = "tsconfig.json";

// ─── helpers ────────────────────────────────────────────────────────────────

const elapsed = (start) => ((Date.now() - start) / 1000).toFixed(1) + "s";

const pkg = (() => {
  try {
    return JSON.parse(fs.readFileSync("package.json", "utf8"));
  } catch {
    return {};
  }
})();

const label = pkg.name
  ? `  ▲ ${pkg.name}${pkg.version ? ` v${pkg.version}` : ""}`
  : "  ▲ build";

const write = (msg) => process.stdout.write(msg);
const writeln = (msg = "") => process.stdout.write(msg + "\n");
const error = (msg) => process.stderr.write(msg + "\n");

// ─── state ──────────────────────────────────────────────────────────────────

const startedAt = Date.now();
let finished = false;
let watchdog = null;
let spinner = null;
let spinFrame = 0;
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ─── spinner ────────────────────────────────────────────────────────────────

const startSpinner = () => {
  if (!process.stdout.isTTY) return;
  spinner = setInterval(() => {
    const frame = FRAMES[spinFrame++ % FRAMES.length];
    process.stdout.write(`\r  ${frame} Compilando... ${elapsed(startedAt)}`);
  }, 80);
};

const stopSpinner = () => {
  if (spinner) {
    clearInterval(spinner);
    spinner = null;
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  }
};

// ─── finalize ───────────────────────────────────────────────────────────────

const finalize = (code, fatal) => {
  if (finished) return;
  finished = true;

  stopSpinner();
  if (watchdog) clearTimeout(watchdog);

  const time = elapsed(startedAt);

  if (fatal) {
    error(`\n  ✗ ${fatal}\n`);
    process.exit(1);
  }

  if (code === 0) {
    writeln();
    writeln(`  \x1b[32m✓ Build concluído\x1b[0m \x1b[2mem ${time}\x1b[0m`);
    writeln();
    process.exit(0);
  }

  writeln();
  error(`  \x1b[31m✗ Build falhou\x1b[0m \x1b[2mem ${time}\x1b[0m\n`);
  process.exit(code ?? 1);
};

// ─── header ─────────────────────────────────────────────────────────────────

writeln();
writeln(`\x1b[2m${label}\x1b[0m`);
writeln();
writeln("  \x1b[1mBuilding for production...\x1b[0m");
writeln();

// ─── spawn tsc ──────────────────────────────────────────────────────────────

const tsc = spawn(
  "node",
  ["--stack-size=65500", path.join("node_modules", "typescript", "lib", "tsc.js"), "-p", TSCONFIG],
  {
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
  }
);

startSpinner();

const tscErrors = [];

tsc.stdout.on("data", (chunk) => {
  stopSpinner();
  write(chunk);
  startSpinner();
});

tsc.stderr.on("data", (chunk) => {
  stopSpinner();
  const lines = chunk.toString().split("\n").filter(Boolean);
  for (const line of lines) {
    tscErrors.push(line);
    error(`  \x1b[2m${line}\x1b[0m`);
  }
  startSpinner();
});

tsc.on("exit", (code) => finalize(code));
tsc.on("error", (err) => finalize(1, `Erro ao executar tsc: ${err.message}`));
tsc.on("close", (code) => finalize(code));

// ─── signals ────────────────────────────────────────────────────────────────

const abort = (sig) => {
  if (finished) return;
  if (!tsc.killed) tsc.kill(sig);
  finalize(130, `Interrompido por ${sig}`);
};

process.on("SIGINT", () => abort("SIGINT"));
process.on("SIGTERM", () => abort("SIGTERM"));

watchdog = setTimeout(() => abort("SIGTERM"), TIMEOUT_MS);
