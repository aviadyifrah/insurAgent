/**
 * Keeps bottom-docked UI (the message box) above the on-screen keyboard. Android Chrome resizes the
 * page itself (interactive-widget in index.html); iOS Safari only shrinks the visual viewport, so we
 * measure how much of the layout viewport the keyboard covers and expose it as --keyboard-inset.
 */
export function trackKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--keyboard-inset", `${Math.round(covered)}px`);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}
