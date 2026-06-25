// Otto landing — progressive enhancement only. Page works fully without JS.

// 1) Nav gets a hairline border once you scroll past the hero.
const nav = document.querySelector(".nav");
const onScroll = () => {
  nav.style.borderBottomColor = window.scrollY > 24 ? "var(--line)" : "transparent";
};
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// 2) Reveal sections as they enter the viewport.
const revealTargets = document.querySelectorAll(
  ".section-head, .step, .card, .plan, .privacy-inner, .install-card, .faq-list, .marquee"
);

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!reduce && "IntersectionObserver" in window) {
  revealTargets.forEach((el, i) => {
    el.classList.add("in-view-init");
    el.style.transitionDelay = `${(i % 3) * 80}ms`;
  });
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  revealTargets.forEach((el) => io.observe(el));
}

// 3) Smooth-close other FAQ items for an accordion feel (optional nicety).
const faqItems = document.querySelectorAll(".faq-list details");
faqItems.forEach((item) => {
  item.addEventListener("toggle", () => {
    if (item.open) {
      faqItems.forEach((other) => { if (other !== item) other.open = false; });
    }
  });
});
