// Proof that the sibling JS file loads under iframe.src= mode.
// A simple sine-wave horizontal slide on the accent dot.
const dot = document.getElementById('dot');
if (dot) {
  let t = 0;
  function tick() {
    t += 0.025;
    const x = Math.sin(t) * 120;
    dot.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
    requestAnimationFrame(tick);
  }
  tick();
}
