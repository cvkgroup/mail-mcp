/**
 * Starting a child and knowing when it stopped.
 *
 * Two things here were learned the hard way and are not negotiable:
 *
 * 1. Output is kept, always. Worker output went to /dev/null for a whole day, so every diagnosis
 *    of a stuck worker was guesswork. One file per attempt is a cheap price for being able to
 *    answer "what was it doing".
 * 2. Exiting is not succeeding. This module reports only that a process ended and with what code.
 *    Whether the work was done is decided elsewhere, from what the worker produced.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

export interface Proc {
  /** True once the child has exited and its output file is closed. */
  readonly done: boolean;
  /** Exit code, or null while still running. A signalled child reports -1. */
  readonly code: number | null;
  readonly argv: readonly string[];
  kill(): void;
}

export interface LaunchOptions {
  cwd: string;
  /** Absolute path; stdout and stderr are both written here. Parent directories are created. */
  logFile?: string;
  /** Run through the shell. `argv` must then be a single command string. */
  shell?: boolean;
}

export function launch(argv: readonly string[], opts: LaunchOptions): Proc {
  let fd: number | null = null;
  if (opts.logFile) {
    mkdirSync(dirname(opts.logFile), { recursive: true });
    fd = openSync(opts.logFile, "w");
  }

  let child: ChildProcess;
  if (opts.shell) {
    if (argv.length !== 1) throw new Error("a shell command must be a single string");
    child = spawn(argv[0]!, {
      cwd: opts.cwd,
      shell: true,
      stdio: ["ignore", fd ?? "ignore", fd ?? "ignore"],
    });
  } else {
    if (argv.length === 0) throw new Error("cannot launch an empty command");
    child = spawn(argv[0]!, argv.slice(1), {
      cwd: opts.cwd,
      stdio: ["ignore", fd ?? "ignore", fd ?? "ignore"],
    });
  }

  const proc = {
    done: false,
    code: null as number | null,
    argv: [...argv],
    kill: () => {
      if (!proc.done) child.kill("SIGKILL");
    },
  };

  const finish = (code: number) => {
    if (proc.done) return;
    proc.code = code;
    proc.done = true;
    if (fd !== null) {
      closeSync(fd);
      fd = null;
    }
  };

  child.on("close", (code, signal) => finish(code ?? (signal ? -1 : 0)));
  // A command that cannot be started at all — the binary is missing, the cwd does not exist —
  // never emits `close` on some platforms. Without this the engine would wait for it forever.
  child.on("error", () => finish(-1));

  return proc;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
