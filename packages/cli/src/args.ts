// Tiny arg parser — no dependency needed for this surface area.
export interface Args {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): Args {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [key, inline] = a.slice(2).split("=", 2);
      if (inline !== undefined) flags[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith("-")) flags[key] = argv[++i];
      else flags[key] = true;
    } else if (a.startsWith("-") && a.length > 1) {
      const key = a.slice(1);
      if (argv[i + 1] && !argv[i + 1].startsWith("-")) flags[key] = argv[++i];
      else flags[key] = true;
    } else positionals.push(a);
  }
  return { command: positionals[0], positionals: positionals.slice(1), flags };
}

export const str = (v: string | boolean | undefined): string | undefined =>
  typeof v === "string" ? v : undefined;
