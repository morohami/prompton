// Proof that the sibling JS file loaded under iframe.src= mode.
// Lights the "html" and "js" check pips synchronously on load — no
// animation, so the thumbnail screenshot captures a stable final state
// with all three checkmarks visible.
(() => {
  const light = (file) => {
    const pip = document.querySelector('.check[data-file="' + file + '"]');
    if (pip) pip.classList.add('on');
  };
  light('html');
  light('js');
  // The 'css' pip is lit by a static CSS rule (see style.css) — so it's
  // already on before this script runs. If the CSS didn't load, that
  // rule can't apply and the CSS pip stays hollow — exactly the failure
  // mode we want the thumbnail to reveal.
})();
