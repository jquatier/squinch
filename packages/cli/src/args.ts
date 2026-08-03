// Tiny arg parser — no dependency needed for this surface area.
export interface Args {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/** A negative number is a value, not the next flag. Without this `--scale -1`
 *  parses as a bare `--scale` and the argument vanishes silently — the flag
 *  reads as "set", the number is lost, and the command succeeds having ignored
 *  what you asked for. Better to let it through and fail validation loudly. */
const isValue = (tok: string | undefined): boolean =>
  tok !== undefined && (!tok.startsWith("-") || /^-\d/.test(tok));

/** Flags that take no argument, so they never consume the token after them.
 *
 *  Without this every boolean eats the following positional:
 *  `render --check examples/orders` bound "examples/orders" to `--check` and
 *  then failed with "usage: squinch render <path>" — and `check -v diagrams/`
 *  was worse, matching the version flag and exiting 0 having validated
 *  nothing. A CLI whose job is to gate CI must never exit 0 without doing the
 *  work, so flag-before-positional order has to parse.
 *
 *  The set is asserted against USAGE in the tests: a documented flag written
 *  without a `<placeholder>` is boolean, and must appear here. */
export const BOOLEAN_FLAGS = new Set([
  "help", "h", "version", "v", "adaptive", "no-flow-steps", "sync", "check",
]);

export function parseArgs(argv: string[]): Args {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const takesValue = (key: string, next: string | undefined) =>
    !BOOLEAN_FLAGS.has(key) && isValue(next);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [key, inline] = a.slice(2).split("=", 2);
      if (inline !== undefined) flags[key] = inline;
      else if (takesValue(key, argv[i + 1])) flags[key] = argv[++i];
      else flags[key] = true;
    } else if (a.startsWith("-") && a.length > 1 && !/^-\d/.test(a)) {
      const key = a.slice(1);
      if (takesValue(key, argv[i + 1])) flags[key] = argv[++i];
      else flags[key] = true;
    } else positionals.push(a);
  }
  return { command: positionals[0], positionals: positionals.slice(1), flags };
}

export const str = (v: string | boolean | undefined): string | undefined =>
  typeof v === "string" ? v : undefined;
