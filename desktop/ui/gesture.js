(() => {
  'use strict';
  const presets = Object.freeze({ crisp: { press: 65, release: 125, squash: .90 }, soft: { press: 85, release: 155, squash: .86 }, balanced: { press: 75, release: 140, squash: .88 } });
  function apply(body, down, name = 'balanced') {
    const p = presets[name] || presets.balanced;
    body.style.transition = `transform ${down ? p.press : p.release}ms cubic-bezier(.2,.8,.3,1.15)`;
    body.style.transform = down ? `scaleY(${p.squash}) scaleX(1.05)` : 'scaleY(1) scaleX(1)';
  }
  window.WhaleGesture = Object.freeze({ presets, apply });
})();
