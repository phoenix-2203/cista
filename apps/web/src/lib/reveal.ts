import { useEffect, type RefObject } from "react";

// Groups whose children rise in one after another.
const GROUPS = ".cards3, .steps, .proof-grid, .qcols, .views, .split, .faq";

/**
 * Fades sections in as they scroll into view. Runs only where
 * IntersectionObserver exists and the device hasn't asked for less motion,
 * so without it everything is simply shown.
 */
export function useReveal(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const targets: HTMLElement[] = [];
    el.querySelectorAll<HTMLElement>(".block, .qday, .closing").forEach((section) => {
      for (const child of Array.from(section.children) as HTMLElement[]) {
        if (child.matches(GROUPS)) {
          (Array.from(child.children) as HTMLElement[]).forEach((item, i) => {
            item.style.setProperty("--i", String(i));
            targets.push(item);
          });
        } else if (!child.matches(".qday-glow")) {
          targets.push(child);
        }
      }
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    for (const t of targets) {
      t.classList.add("reveal");
      io.observe(t);
    }
    return () => io.disconnect();
  }, [root]);
}
