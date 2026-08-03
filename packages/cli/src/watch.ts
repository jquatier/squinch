// Watching a project, portably.
//
// `squinch watch` used to arm fs.watch on the path it was given. For a single
// file that is a trap on Windows: the standard editor save is write-temp then
// rename, which replaces the directory entry, and a watcher holding the old
// entry goes permanently deaf — no error, no event, the preview simply stops
// updating and looks like the renderer hung. Watching the *directory* and
// filtering by name survives the rename, on every platform.
//
// Extracted from cmdWatch because cmdWatch returns a promise that never
// resolves and cannot be tested. This can: arm it on a temp dir, perform an
// atomic save, assert the callback fires.
import { watch as fsWatch, statSync, type FSWatcher } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export interface Watcher {
  close(): void;
}

/** Call `onChange` when `path` (a file or a project directory) changes.
 *
 *  Bursts are debounced: one editor save can raise several events, and Windows
 *  raises more of them than macOS does. */
export function watchPaths(path: string, onChange: () => void, debounceMs = 60): Watcher {
  const abs = resolve(path);
  const isDir = statSync(abs).isDirectory();
  const dir = isDir ? abs : dirname(abs);
  const target = isDir ? undefined : basename(abs);

  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher | undefined;
  let closed = false;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };

  const relevant = (name: string | null) => {
    // A null filename means "something changed here and the platform declined
    // to say what" — treat it as a change rather than dropping it.
    if (name === null) return true;
    return target ? basename(name) === target : name.endsWith(".squinch");
  };

  const arm = () => {
    if (closed) return;
    watcher = fsWatch(dir, { recursive: isDir }, (_event, name) => {
      if (relevant(name)) schedule();
    });
    // Windows raises EPERM if the watched directory is replaced. Re-arm rather
    // than dying silently, which is the failure this whole file exists to fix.
    watcher.on("error", () => {
      watcher?.close();
      watcher = undefined;
      setTimeout(arm, 200);
    });
  };
  arm();

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      watcher?.close();
    },
  };
}
