#!/usr/bin/env node

const { spawn } = require("node:child_process");

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const startedAt = Date.now();
let frameIndex = 0;
let interval = null;

const formatSeconds = (ms) => (ms / 1000).toFixed(1);

const writeSpinner = () => {
  if (!process.stdout.isTTY) return;
  const frame = frames[frameIndex % frames.length];
  frameIndex += 1;
  process.stdout.write(
    `\r${frame} Validando TypeScript e gerando arquivos em dist...`,
  );
};

const stopSpinner = () => {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
};

const tsc = spawn("tsc", {
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
});

if (process.stdout.isTTY) {
  writeSpinner();
  interval = setInterval(writeSpinner, 90);
} else {
  process.stdout.write(
    "Validando TypeScript e gerando arquivos em dist...\n",
  );
}

tsc.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});

tsc.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

tsc.on("close", (code) => {
  stopSpinner();
  const duration = formatSeconds(Date.now() - startedAt);

  if (process.stdout.isTTY) {
    process.stdout.write("\r");
    process.stdout.clearLine(0);
  }

  if (code === 0) {
    process.stdout.write(`✅ Build concluído em ${duration}s\n`);
    process.exit(0);
  }

  process.stderr.write(`❌ Build falhou em ${duration}s\n`);
  process.exit(code || 1);
});

tsc.on("error", (error) => {
  stopSpinner();
  if (process.stdout.isTTY) {
    process.stdout.write("\r");
    process.stdout.clearLine(0);
  }
  process.stderr.write(`❌ Erro ao executar TypeScript: ${error.message}\n`);
  process.exit(1);
});
