// Wiring @squinch/core into the browser: packs are fetched as static assets and
// resolved before each (synchronous) render.
import {
  registerPack, preloadIcons, iconsUsedBy, render, buildProject, viewIndex,
  type PackManifest, type Diagnostic,
} from "@squinch/core/browser";

export interface ViewRef {
  name: string;
  scope?: string;
  title?: string;
}

let ready: Promise<void> | undefined;

/** Load the AWS pack manifest once; icons stream in on demand. */
export function ensurePacks(): Promise<void> {
  ready ??= (async () => {
    const manifest = (await (await fetch("pack-aws.json")).json()) as PackManifest;
    registerPack(manifest, async (file) => (await fetch(`icons/${file}`)).text());
  })();
  return ready;
}

export interface Preview {
  svg?: string;
  diagnostics: Diagnostic[];
  ok: boolean;
  views: ViewRef[];
}

export async function compile(
  source: string,
  opts: { view?: string; theme: string },
): Promise<Preview> {
  await ensurePacks();
  const built = buildProject([{ name: "diagram.squinch", src: source }]);
  const views: ViewRef[] = built.ok ? viewIndex(source) : [];
  if (!views.length) {
    const first = [...built.model.containers.keys()][0];
    if (first) views.push({ name: first, scope: first });
  }
  if (!built.ok) return { diagnostics: built.diagnostics, ok: false, views };

  // Rendering is synchronous, so the artwork has to be resident first.
  await preloadIcons(iconsUsedBy(source));
  const view = views.find((v) => v.name === opts.view)?.name ?? views[0]?.name;
  const result = await render(source, { view, theme: opts.theme });
  return { ...result, views };
}

/** Share links keep the source in the fragment — it never reaches a server. */
export function encodeShare(source: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(source)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeShare(fragment: string): string | undefined {
  try {
    const b64 = fragment.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return undefined;
  }
}
