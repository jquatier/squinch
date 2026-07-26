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

/** Load every pack manifest once; icons stream in on demand.
 *  Paths match what scripts/sync-packs.ts writes into public/. */
const PACKS = ["aws", "azure", "logos"].map((name) => ({
  manifest: `pack-${name}.json`,
  icons: `${name}-icons`,
}));
export function ensurePacks(): Promise<void> {
  ready ??= (async () => {
    await Promise.all(
      PACKS.map(async (p) => {
        const manifest = (await (await fetch(p.manifest)).json()) as PackManifest;
        registerPack(manifest, async (file) => (await fetch(`${p.icons}/${file}`)).text());
      }),
    );
  })();
  return ready;
}

export interface Preview {
  svg?: string;
  diagnostics: Diagnostic[];
  ok: boolean;
  views: ViewRef[];
  /** set when the active view shows a flow — `steps` is how far it can be walked */
  flow?: { label: string; steps: number };
}

export async function compile(
  source: string,
  opts: { view?: string; theme: string; flowStep?: number },
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
  const result = await render(source, { view, theme: opts.theme, flowStep: opts.flowStep });
  return { ...result, views };
}

/** Rasterize for the places an SVG won't paste: slides, docs, chat.
 *
 *  Everything happens in the page — an <img> decodes the SVG (fonts and all,
 *  since they travel inside it as data-URIs) and a canvas re-encodes it. No
 *  server, no library. Returns an object URL, or undefined if the browser
 *  refused to decode; the caller revokes it. */
export async function svgToPng(svg: string, scale = 2): Promise<string | undefined> {
  const src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error("decode failed"));
      img.src = src;
    });
    // The <svg> carries explicit width/height, so naturalWidth is the design
    // size — no viewBox maths needed.
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    return blob ? URL.createObjectURL(blob) : undefined;
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(src);
  }
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
