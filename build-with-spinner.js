#!/usr/bin/env node

const { spawn } = require("node:child_process");

const startedAt = Date.now();
let progressInterval = null;
let watchdog = null;
let finished = false;

const formatSeconds = (ms) => (ms / 1000).toFixed(1);

const startProgressLogs = () => {
  process.stdout.write("Validando TypeScript e gerando arquivos em dist...\n");
  progressInterval = setInterval(() => {
    if (finished) return;
    const elapsed = formatSeconds(Date.now() - startedAt);
    process.stdout.write(`⌛ Build em andamento... ${elapsed}s\n`);
  }, 10000);
};

const stopProgressLogs = () => {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
};

const finalize = (code, errorMessage) => {
  if (finished) return;
  finished = true;
  stopProgressLogs();
  if (watchdog) {
    clearTimeout(watchdog);
    watchdog = null;
  }
  const duration = formatSeconds(Date.now() - startedAt);

  if (errorMessage) {
    process.stderr.write(`❌ ${errorMessage}\n`);
    process.exit(1);
  }

  if (code === 0) {
    process.stdout.write(`✅ Build concluído em ${duration}s\n`);
    process.exit(0);
  }

  process.stderr.write(`❌ Build falhou em ${duration}s\n`);
  process.exit(code || 1);
};

const tsc = spawn("tsc", ["-p", "tsconfig.json"], {
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
});

startProgressLogs();

tsc.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});

tsc.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

tsc.on("exit", (code) => {
  finalize(code);
});

tsc.on("error", (error) => {
  finalize(1, `Erro ao executar TypeScript: ${error.message}`);
});

tsc.on("close", (code) => {
  finalize(code);
});

const killChild = (signal) => {
  if (finished) return;
  if (!tsc.killed) {
    tsc.kill(signal);
  }
  finalize(130, `Build interrompido por ${signal}`);
};

process.on("SIGINT", () => killChild("SIGINT"));
process.on("SIGTERM", () => killChild("SIGTERM"));

watchdog = setTimeout(() => {
  killChild("SIGTERM");
}, 1000 * 60 * 15);
