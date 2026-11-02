# Note — the update notices, and why they are shaped the way they are

Engineering note, not a requirement. `squinch` prints two lines after a
successful command: `update:` when npm has a newer version, and `skill:` when
an installed SKILL.md was written by a different squinch than the one running.
Both live in `packages/cli/src/update.ts`, which is the only module in the
product that reads the clock, the environment or the network (core's
guardrails now assert it stays that way). This records the shape, the
measurements behind it, and what was rejected.

## Who reads it

A coding agent, in tool output. That single fact decides most of the design:

- **Not TTY-gated.** npm and update-notifier go quiet when stderr is not a
  terminal. Agents never have one, so that convention would hide the feature
  from its whole audience. The gate is `CI` / `GITHUB_ACTIONS` /
  `SQUINCH_NO_UPDATE_CHECK` instead — environments where nobody reads it.
- **stderr, prefixed, last, and only on exit 0.** stderr is already this
  CLI's status channel (`3 file(s) OK`, `wrote …`, `note:`); stdout carries
  artifacts (the SVG pipe, `check --format json`, the README snippet) and
  gains nothing. The prefix is a lowercase word and a colon like `error:`
  and `note:`, never the `file:line:col severity:` shape of a diagnostic,
  because the skill's definition of clean is "exit 0 and no diagnostics".
  Printing only after success means a notice never sits beside a real
  error, where an agent would read it as part of the failure.
- **A JSON field on `check`.** `check --format json` and the human format
  carry identical information, so the same facts ride the payload as
  `update` / `skill` and the stderr line is suppressed. `diff --format json`
  gets no field: the squinch-diff Action pastes diff's stdout into a pull
  request comment.
- **The skill says what it is.** SKILL.md rule 4 tells the agent the line is
  information, to mention it once, and never to upgrade or reinstall unasked
  — an upgrade can change render bytes, which makes every committed SVG
  stale under `--check`, and that is the user's decision.

## The mechanism: cache, then notice; a short grace only when it fetched

`collectNotices` is synchronous and reads only a cache file and a few
SKILL.md heads. `refreshCache` starts a registry GET when the cache is stale,
before dispatch, and `main` gives it **`GRACE_MS` (500 ms) once the command is
done** (`settleRefresh`) before `cli.ts` calls `process.exit`. A fetch slower
than that dies with the process, and the next run reads what a finished one
wrote. When the cache is fresh no fetch starts, the promise is already
settled, and the wait costs nothing — so the grace is paid once a day after
a success, once per backoff after a failure, and by no other run.

This used to be "never awaited", on the theory that the command's own
runtime was the fetch's window and a `check` (~0.5 s) was long enough. It is
not a window at all: every command's work is synchronous, so the event loop
does not turn while it runs and the fetch cannot so much as resolve DNS
until the command returns — at which point `process.exit` killed it. Every
`check`, `--version`, `icons` and single-view `render` wrote the attempt
stamp and never a `latest`; only a multi-view `render --sync`, with enough
`await`s inside it, let a fetch finish. Users saw `update.json` rewritten
every ten minutes and never a notice. Measured against the real registry
(~115 ms away), a stale-cache `check` now records `latest` every time, at
~100 ms over a fresh-cache one. The grace timer is deliberately not
`unref`'d: with nothing else holding the loop, Node would exit by itself
with status 0 and swallow a failing command's exit code.

Two consequences, both handled:

- **Two TTLs.** `checkedAt` is written at attempt time (so concurrent agent
  processes don't all fetch, and a failure backs off). A cache that knows a
  `latest` is fresh for 24 h; one without is fresh for 10 min. With one TTL,
  a day whose first command was `squinch --version` — which exits before
  any registry answers — would have blanked every notice until tomorrow.
  A known `latest` survives a failed attempt: yesterday's fact beats none.
- **No unhandled rejection.** An offline `ENOTFOUND` rejects in
  milliseconds, before the command finishes; Node's default would turn that
  into exit 1 with a stack trace on a clean project — the one failure a
  gate must never have. The whole chain is caught, the abort timer is
  unref'd, and every fs call is swallowed (a read-only home means no cache
  and no notice, not a broken `check`).

The cache is `update.json` under `$SQUINCH_CACHE_DIR`, else
`$XDG_CACHE_HOME/squinch`, else `~/.cache/squinch` — never the checkout,
which a CI gate must not write to. It is written to a per-pid temp file and
renamed; Windows refuses to replace a file another process has open, and
that write is simply dropped (the other writer's payload is equivalent).

## The skill stamp is a record that already existed

`squinch skill` has stamped `<!-- installed by squinch x.y.z … -->` under the
frontmatter since the skill and the CLI shipped together; the drift check
only reads it. It walks up from cwd to the first directory holding
`.agents/skills/squinch/SKILL.md` or `.claude/skills/squinch/SKILL.md` — the
rule the agents themselves discover skills by — then adds the home copies.
No git: `repoRoot` throws outside a repository and costs a spawn on a
startup-bound CLI. An unstamped copy is silent — a hand copy or a pre-stamp
install may be a file the user owns, and a false positive tells an agent
to overwrite it. Plugin-installed skills live outside those paths and are
never flagged; the plugin updates itself.

## Rejected

- **Await the fetch on every run, with a timeout.** What shipped awaits
  only the run that *started* a fetch; awaiting on every run would add the
  wait to commands that have nothing in flight. The notice still arrives
  one run late — the JSON is printed during the command, and showing a
  notice on stderr that the JSON of the same run lacks would break their
  parity.
- **A detached child process** (update-notifier's answer to the same
  problem). A second process per invocation, and the gauntlet bundles the
  CLI to one file, so there is no script path to hand it.
- **GitHub releases API.** Sixty unauthenticated requests an hour.
- **A `version.json` on squinch.cc.** Could carry a "what's new" line, but
  can drift from what `npm i -g squinch@latest` actually installs. The
  registry is the truth for the command the notice recommends.
- **A lock-style file in the checkout.** `squinch.lock` already died once
  for being write-only (`version-stamp.md`), and a gate must not write.
- **Detecting skill drift without a stamp** (hashing the installed file
  against the bundled one). Cannot tell "older" from "newer" from "edited
  by the user", and the last of those must stay silent.

## Not done, on purpose

`npm_config_registry` is not honoured; a private mirror fails silently and
the notice never appears, which is acceptable. The VS Code extension has
the marketplace. Whether cold agents actually relay the line is a gauntlet
question — a round can seed the cache with a fake `latest` through
`SQUINCH_CACHE_DIR` and count misreports — and the wording is what changes
if they don't.
