const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealItems = document.querySelectorAll("[data-reveal]");
const topbar = document.querySelector(".topbar");
const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");
const lightbox = document.querySelector("#screenshot-lightbox");
const lightboxImage = lightbox?.querySelector("img");
const lightboxClose = lightbox?.querySelector(".lightbox-close");
const discordCount = document.querySelector("#discord-count");

if (reducedMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12 });

  revealItems.forEach((item) => observer.observe(item));
}

function syncNavState() {
  topbar?.classList.toggle("scrolled", window.scrollY > 6);
}

function closeNav() {
  navToggle?.setAttribute("aria-expanded", "false");
  navLinks?.classList.remove("is-open");
  document.body.classList.remove("nav-open");
}

function toggleNav() {
  const open = navToggle?.getAttribute("aria-expanded") !== "true";
  navToggle?.setAttribute("aria-expanded", String(open));
  navLinks?.classList.toggle("is-open", open);
  document.body.classList.toggle("nav-open", open);
}

function openLightbox(src, alt) {
  if (!lightbox || !lightboxImage) return;
  lightboxImage.src = src;
  lightboxImage.alt = alt || "Charon screenshot";
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("nav-open");
}

function closeLightbox() {
  if (!lightbox || !lightboxImage) return;
  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
  lightboxImage.removeAttribute("src");
  document.body.classList.remove("nav-open");
}

async function loadDiscordCount() {
  if (!discordCount) return;
  try {
    const response = await fetch("https://discord.com/api/v10/invites/Qq2yACbXyf?with_counts=true", {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const members = Number(data.approximate_member_count || 0);
    const online = Number(data.approximate_presence_count || 0);
    if (!members) throw new Error("Discord count unavailable");
    discordCount.textContent = `${members.toLocaleString()}+ members${online ? ` · ${online.toLocaleString()} online` : ""}`;
  } catch {
    discordCount.textContent = "Live community support on Discord";
  }
}

syncNavState();
loadDiscordCount();
window.addEventListener("scroll", syncNavState, { passive: true });
navToggle?.addEventListener("click", toggleNav);
navLinks?.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeNav();
});
document.querySelectorAll("[data-lightbox]").forEach((button) => {
  button.addEventListener("click", () => {
    const image = button.querySelector("img");
    openLightbox(button.dataset.lightbox, image?.alt);
  });
});
lightboxClose?.addEventListener("click", closeLightbox);
lightbox?.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeNav();
    closeLightbox();
  }
});
