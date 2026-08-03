// Icon attribution. The playground serves pack artwork to whoever loads it,
// and three of the five packs require credit to travel with the files —
// AWS's CC-BY-ND and the Kubernetes set's CC-BY-4.0 by licence, Azure's terms
// by being narrower than one. Shipped as npm packages the NOTICE files do
// that job; served as a web page nothing does, so this panel is the NOTICE.
//
// Every line is read from the registered manifests via `packInfo`, never
// retyped here: the licence a visitor reads is the licence the pack declares.
import { useEffect, useState } from "react";
import { packInfo } from "@squinch/core/browser";
import { ensurePacks, PACK_NAMES } from "./squinch";

export function CreditsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (open) ensurePacks().then(() => setReady(true));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [open, onClose]);

  if (!open) return null;
  const packs = ready ? PACK_NAMES.map((n) => [n, packInfo(n)] as const).filter(([, m]) => m) : [];
  const total = packs.reduce((n, [, m]) => n + Object.keys(m!.icons).length, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Icon credits"
        className="w-[540px] max-w-[92vw] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--chrome)] shadow-2xl"
      >
        <div className="border-b border-[var(--line)] px-4 py-3">
          <div className="text-[13px] font-medium text-[var(--fg)]">Icon credits</div>
          <div className="mt-0.5 text-[11px] text-[var(--muted)]">
            {total ? `${total.toLocaleString()} marks` : "Loading"} from five packs, each redistributed
            under its own terms. Artwork is drawn verbatim — Squinch applies theme treatment at
            render time and never edits the asset.
          </div>
        </div>

        <div className="max-h-[52vh] overflow-y-auto">
          {packs.map(([name, m]) => (
            <div key={name} className="border-b border-[var(--line)] px-4 py-2.5 last:border-b-0">
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] text-[var(--fg)]">{m!.title}</span>
                <span className="text-[10px] text-[var(--muted)]">
                  {name}/* · {Object.keys(m!.icons).length}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)]">{m!.attribution}</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                {m!.license}
                {m!.source?.startsWith("http") && (
                  <>
                    {" · "}
                    <a
                      href={m!.source}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline decoration-dotted underline-offset-2 hover:text-[var(--fg)]"
                    >
                      source
                    </a>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[var(--line)] px-4 py-2 text-[10px] leading-relaxed text-[var(--muted)]">
          Microsoft's grant covers architecture diagrams, training and documentation only, and does
          not travel to other uses. Cloud artwork must not be modified. Brand marks remain their
          owners' trademarks; use here is nominative. Squinch itself is Apache-2.0. · esc close
        </div>
      </div>
    </div>
  );
}
