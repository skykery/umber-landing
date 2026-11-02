// Before/after slider: iPhone camera on the left, Umber on the right.
for (const el of document.querySelectorAll('[data-compare]')) {
  const range = el.querySelector('.cmp-range');
  let pos = 50, dragging = false, hinted = false, raf = 0;

  const set = (v) => {
    pos = Math.min(100, Math.max(0, v));
    el.style.setProperty('--pos', pos + '%');
    el.dataset.edge = pos < 18 ? 'l' : pos > 82 ? 'r' : '';
    range.value = Math.round(pos);
    range.setAttribute('aria-valuetext', `${Math.round(pos)}% iPhone camera, ${100 - Math.round(pos)}% Umber`);
  };
  const fromEvent = (e) => {
    const r = el.getBoundingClientRect();
    set(((e.clientX - r.left) / r.width) * 100);
  };

  // Mouse and pen drag at once. Touch waits for a clearly horizontal move, so a
  // vertical page scroll that starts on the photo never moves the divider.
  let start = null;
  const begin = (e) => {
    cancelAnimationFrame(raf); hinted = true;
    dragging = true;
    try { el.setPointerCapture(e.pointerId); } catch {}
    fromEvent(e);
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.pointerType === 'touch') { start = { x: e.clientX, y: e.clientY }; return; }
    begin(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (dragging) { fromEvent(e); return; }
    if (!start) return;
    const dx = Math.abs(e.clientX - start.x), dy = Math.abs(e.clientY - start.y);
    if (dx > 8 && dx > dy * 1.2) { start = null; begin(e); }
    else if (dy > 10) start = null; // it's a scroll
  });
  el.addEventListener('pointerup', (e) => {
    if (start) begin(e); // a tap jumps the divider there
    start = null; dragging = false;
  });
  el.addEventListener('pointercancel', () => { start = null; dragging = false; });
  range.addEventListener('input', () => { cancelAnimationFrame(raf); hinted = true; set(+range.value); });

  set(50);

  // One gentle sweep the first time it scrolls into view, so it reads as draggable.
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting || hinted) return;
      hinted = true; io.disconnect();
      const keys = [[0, 50], [700, 28], [1500, 72], [2100, 50]];
      const t0 = performance.now() + 250;
      const ease = (t) => (t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
      const tick = (now) => {
        const t = now - t0;
        if (t < 0) { raf = requestAnimationFrame(tick); return; }
        let i = 1;
        while (i < keys.length - 1 && t > keys[i][0]) i++;
        const [ta, a] = keys[i - 1], [tb, b] = keys[i];
        const k = Math.min(1, Math.max(0, (t - ta) / (tb - ta)));
        set(a + (b - a) * ease(k));
        if (t < keys[keys.length - 1][0]) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.6 });
    io.observe(el);
  }
}
