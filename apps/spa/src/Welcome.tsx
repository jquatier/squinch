// First-visit greeting. Shows once (localStorage-gated), reopens from the
// wordmark in the header. Deliberately light: the playground teaches itself
// through the examples menu, so this is a signpost, not a tour.
import { useEffect, useState } from "react";
import markUrl from "./mark.svg";

const REPO = "https://github.com/jquatier/squinch";
// One paste in a terminal. The CLI bundles the skill and knows where every
// agent looks: `.agents/skills/` in a project is the cross-client discovery
// convention of the open Agent Skills standard (agentskills.io — Cursor,
// Codex, Gemini CLI, Copilot, Goose, …), with a `.claude/skills/` copy added
// when the project shows Claude Code markers; `--global` is Claude Code's
// personal install, which follows its user everywhere. The commands are armed
// at launch — they work the moment `squinch` is on npm — same posture as the
// links below and the Pages workflow.
const INSTALLS: { label: string; command: string }[] = [
  { label: "Any agent", command: "npx squinch skill" },
  { label: "Claude Code", command: "npx squinch skill --global" },
];

const LINKS: { label: string; hint: string; href: string }[] = [
  { label: "README", hint: "what Squinch is, and the five-minute tour", href: REPO },
  { label: "Lookbook", hint: "thirty stress-case diagrams, light and dark", href: `${REPO}/tree/main/lookbook` },
];

export function WelcomeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState<string>();
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[14vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Welcome to Squinch"
        className="w-[460px] max-w-[92vw] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--chrome)] shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4">
          <img src={markUrl} width={32} height={32} alt="" />
          <div>
            <div className="text-[14px] font-medium tracking-tight text-[var(--fg)]">
              squinch <span className="font-normal text-[var(--muted)]">playground</span>
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--muted)]">
              architecture diagrams as code
            </div>
          </div>
        </div>

        <div className="px-5 py-4 text-[12px] leading-relaxed text-[var(--fg)]">
          Write the <em>model</em> — systems, components, connections — and the engine draws
          it. No pixel coordinates, deterministic output, five themes. Everything here runs
          in your browser: share links carry the source in the URL itself, and nothing you
          type leaves this page.
        </div>

        <div className="border-t border-[var(--line)] px-5 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] text-[var(--fg)]">Using an AI agent to draw?</span>
            <span className="text-[11px] text-[var(--muted)]">one command installs the skill in your repo</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {INSTALLS.map((i) => (
              <button
                key={i.label}
                className="rounded border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[11px] text-[var(--fg)] hover:bg-[var(--chip)]"
                onClick={() => {
                  const done = () => {
                    setCopied(i.label);
                    setTimeout(() => setCopied(undefined), 1600);
                  };
                  // execCommand fallback: clipboard-write is permission-gated
                  // in some embeds, and a copy button that silently does
                  // nothing is worse than no button.
                  navigator.clipboard.writeText(i.command).then(done, () => {
                    const ta = document.createElement("textarea");
                    ta.value = i.command;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand("copy");
                    ta.remove();
                    done();
                  });
                }}
              >
                {copied === i.label ? "Copied — paste in a terminal" : i.label}
              </button>
            ))}
            <a
              className="text-[11px] text-[var(--muted)] underline decoration-[var(--line)] underline-offset-2 hover:text-[var(--fg)]"
              href={`${REPO}/blob/main/packages/skill/skills/squinch/SKILL.md`}
              target="_blank"
              rel="noreferrer"
            >
              or grab SKILL.md
            </a>
          </div>
        </div>

        <div className="border-t border-[var(--line)]">
          {LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-baseline gap-2 border-b border-[var(--line)] px-5 py-2.5 last:border-b-0 hover:bg-[var(--chip)]"
            >
              <span className="text-[12px] text-[var(--fg)]">{l.label}</span>
              <span className="text-[11px] text-[var(--muted)]">{l.hint}</span>
              <span className="ml-auto text-[11px] text-[var(--muted)]">↗</span>
            </a>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--line)] px-5 py-3">
          <span className="text-[11px] text-[var(--muted)]">
            Pick an example from the menu, or just start typing.
          </span>
          <button
            className="rounded border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-[12px] text-[var(--fg)] hover:bg-[var(--chip)]"
            onClick={onClose}
            autoFocus
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
