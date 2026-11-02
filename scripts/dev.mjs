import { spawn } from "node:child_process";

const children = ["server", "client"].map((workspace) =>
  spawn("npm", ["run", "dev", "--workspace", workspace], {
    stdio: "inherit",
    shell: process.platform === "win32",
  }),
);
let stopping = false;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
}

for (const child of children) {
  child.on("error", (error) => {
    console.error("Could not start a development server:", error);
    stop("SIGTERM");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    if (!stopping && code !== 0) stop("SIGTERM");
    if (children.every((process) => process.exitCode !== null)) {
      process.exitCode ??= code ?? 0;
    }
  });
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
