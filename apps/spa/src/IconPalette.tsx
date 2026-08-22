// ⌘K icon search: find a pack icon by name, insert `aws/<id>` at the cursor.
// Search runs against the registered pack registry (same data the compiler
// validates against), so anything you pick is guaranteed to check clean.
import { useEffect, useRef, useState } from "react";
import { glyph, packInfo, searchIcons } from "@squinch/core/browser";
import { ensurePacks } from "./squinch";

/** How an entry previews, matching what the renderer would draw for it.
 *
 *  Artwork URLs are `<pack>-icons/<file>`, the layout sync-packs.ts writes into
 *  public/ — one directory per pack, and the file name comes from the manifest
 *  rather than the id, since aliases (aws/sqs) have no file of their own and
 *  resolve to the canonical entry's.
 *
 *  Monochrome packs get the plate-and-tint treatment the renderer gives them:
 *  Simple Icons marks are near-black, so drawn raw they are invisible against
 *  the dark chrome — which looks exactly like a broken image. */
function Thumb({ pack, id }: { pack: string; id: string }) {
  const g = glyph(pack, id); // builtin/sys entries are lettered plates, not files
  if (g)
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] text-[8px] font-medium text-white"
        style={{ backgroundColor: g.color }}
      >
        {g.code}
      </span>
    );

  const manifest = packInfo(pack);
  const icon = manifest?.icons[manifest.aliases?.[id] ?? id];
  if (!icon) return <span className="h-5 w-5 shrink-0" />;
  // anchored on BASE_URL, not the document: the playground lives at
  // /playground/, and a document-relative URL asked for
  // /playground/aws-icons/… — which the SPA fallback answered with HTML
  const src = `${import.meta.env.BASE_URL}${pack}-icons/${icon.file}`;

  if (!manifest?.monochrome)
    return <img src={src} alt="" className="h-5 w-5 shrink-0 rounded-[3px]" />;
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px]"
      style={{ backgroundColor: icon.color ?? "#6F6E69" }}
    >
      <img src={src} alt="" className="h-3 w-3 brightness-0 invert" />
    </span>
  );
}

const MAX = 24;

export function IconPalette({
  open,
  onClose,
  onPick,
  onCredits,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (ref: string) => void;
  /** the packs' licences and attribution — reachable from where they're browsed */
  onCredits: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSel(0);
    ensurePacks().then(() => setResults(searchIcons("").slice(0, MAX)));
    // focus after the modal paints
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    ensurePacks().then(() => {
      setResults(searchIcons(query.trim()).slice(0, MAX));
      setSel(0);
    });
  }, [query, open]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-i="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const pick = (ref: string) => {
    onPick(ref);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[420px] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--chrome)] shadow-2xl">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter" && results[sel]) pick(results[sel]);
          }}
          placeholder="Search icons — queue, kafka, lambda…"
          className="w-full border-b border-[var(--line)] bg-transparent px-4 py-3 text-[13px] text-[var(--fg)] outline-none placeholder:text-[var(--muted)]"
        />
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-3 text-[12px] text-[var(--muted)]">
              No icons match — try a broader term.
            </div>
          )}
          {results.map((ref, i) => {
            const [pack, id] = ref.split("/");
            return (
              <button
                key={ref}
                data-i={i}
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(ref)}
                className={`flex w-full items-center gap-3 px-4 py-1.5 text-left text-[13px] ${
                  i === sel ? "bg-[var(--chip)]" : ""
                }`}
              >
                <Thumb pack={pack} id={id} />
                <span className="text-[var(--fg)]">{ref}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--line)] px-4 py-2 text-[10px] text-[var(--muted)]">
          <span>↑↓ navigate · ⏎ insert at cursor · esc close</span>
          <span className="flex-1" />
          <button
            onClick={onCredits}
            className="underline decoration-dotted underline-offset-2 hover:text-[var(--fg)]"
          >
            credits
          </button>
        </div>
      </div>
    </div>
  );
}
