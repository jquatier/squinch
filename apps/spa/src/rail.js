// Scroll-spy for the section rail, shared by every page that has one and
// inlined at a page's rail-spy placeholder (site-shell.ts). Plain script,
// not a module: the static pages load no bundle, and this keeps it that way.
//
// The active entry is the first section, in page order, that overlaps the
// upper part of the viewport. The root margin shrinks the observed band, so a
// card counts as "current" once its head has scrolled into the top fifth, not
// the moment a pixel of it appears. The rail scrolls its own content, so the
// active entry is also kept in view inside it.
if ("IntersectionObserver" in window) {
  const links = [...document.querySelectorAll(".rail a[href^='#']")];
  const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const visible = new Set();
  const pick = () => {
    const first = [...byId.keys()].find((id) => visible.has(id));
    if (!first) return;
    for (const [id, a] of byId) {
      const on = id === first;
      a.classList.toggle("is-active", on);
      // done by hand rather than scrollIntoView, which would also scroll the
      // page to it and fight the reader's own scrolling
      const rail = on && a.closest(".rail");
      if (rail) {
        const top = a.offsetTop, bottom = top + a.offsetHeight;
        if (top < rail.scrollTop || bottom > rail.scrollTop + rail.clientHeight)
          rail.scrollTop = top - rail.clientHeight / 2;
      }
    }
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id);
      pick();
    },
    { rootMargin: "-15% 0px -70% 0px" },
  );
  for (const id of byId.keys()) {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  }
}
