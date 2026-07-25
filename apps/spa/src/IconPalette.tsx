// ⌘K icon search: find a pack icon by name, insert `aws/<id>` at the cursor.
// Search runs against the registered pack registry (same data the compiler
// validates against), so anything you pick is guaranteed to check clean.
import { useEffect, useRef, useState } from "react";
import { glyph, packInfo, searchIcons } from "@squinch/core/browser";
import { ensurePacks } from "./squinch";

// aliases (aws/sqs) have no file of their own — the image is the canonical's
const iconFile = (pack: string, id: string) =>
  packInfo(pack)?.aliases?.[id] ?? id;

const MAX = 24;

export function IconPalette({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (ref: string) => void;
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
            const g = glyph(pack, id); // builtin/sys entries are lettered plates, not files
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
                {g ? (
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-[3px] text-[8px] font-medium text-white"
                    style={{ backgroundColor: g.color }}
                  >
                    {g.code}
                  </span>
                ) : (
                  <img src={`icons/${iconFile(pack, id)}.svg`} alt="" className="h-5 w-5 rounded-[3px]" />
                )}
                <span className="text-[var(--fg)]">{ref}</span>
              </button>
            );
          })}
        </div>
        <div className="border-t border-[var(--line)] px-4 py-2 text-[10px] text-[var(--muted)]">
          ↑↓ navigate · ⏎ insert at cursor · esc close
        </div>
      </div>
    </div>
  );
}
