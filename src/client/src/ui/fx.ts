const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Brief soap-bubble rupture over an element that is about to disappear: the iridescent film flashes outwards and a
 * few droplets scatter. Purely visual; the sound is played once per store pop event.
 */
export function rupture(target: Element | DOMRect | null | undefined, delay = 0) {
  if (!target || reducedMotion()) return;
  const r = target instanceof DOMRect ? target : target.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return;
  const el = document.createElement('div');
  el.className = 'rupture';
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
  el.style.animationDelay = `${delay}ms`;
  const radius = target instanceof Element ? getComputedStyle(target).borderRadius : '';
  el.style.borderRadius = radius && radius !== '0px' ? radius : `${Math.min(r.width, r.height) / 2}px`;
  const count = r.width > 120 ? 8 : 5;
  for (let i = 0; i < count; i++) {
    const drop = document.createElement('span');
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const distance = 10 + Math.random() * 14 + Math.min(r.width, 200) * 0.06;
    drop.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    drop.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
    drop.style.left = `${50 + Math.cos(angle) * 46}%`;
    drop.style.top = `${50 + Math.sin(angle) * 46}%`;
    drop.style.animationDelay = `${delay}ms`;
    el.append(drop);
  }
  document.body.append(el);
  setTimeout(() => el.remove(), 420 + delay);
}

/** Rupture every bubble of a family (one sound is still played by the store event). */
export function ruptureAll(root: Element | null | undefined) {
  root?.querySelectorAll('.bubble').forEach((b, i) => rupture(b, i * 35));
}
