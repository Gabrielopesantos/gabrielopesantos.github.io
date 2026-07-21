(function () {
  'use strict';

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoise2D(rand) {
    const perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function lerp(a, b, t) { return a + t * (b - a); }
    function grad(h, x, y) {
      const angle = (h & 7) * (Math.PI / 4);
      return Math.cos(angle) * x + Math.sin(angle) * y;
    }
    return function (x, y) {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
      const xf = x - Math.floor(x), yf = y - Math.floor(y);
      const u = fade(xf), v = fade(yf);
      const aa = perm[X + perm[Y]], ab = perm[X + perm[Y + 1]];
      const ba = perm[X + 1 + perm[Y]], bb = perm[X + 1 + perm[Y + 1]];
      const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
      const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
      return lerp(x1, x2, v);
    };
  }

  function wrapT(t) {
    return ((t % 1) + 1) % 1;
  }

  function makeGradient(rand) {
    const numStops = 3 + Math.floor(rand() * 2);
    const stops = [];
    let h = rand() * 360;
    for (let i = 0; i < numStops; i++) {
      stops.push(h);
      h = (h + 30 + rand() * 90) % 360;
    }
    const sat = 55 + rand() * 30;
    const light = 45 + rand() * 18;
    return function (t) {
      t = wrapT(t);
      const scaled = t * (stops.length - 1);
      const i = Math.floor(scaled);
      const frac = scaled - i;
      const h0 = stops[i], h1 = stops[Math.min(i + 1, stops.length - 1)];
      let diff = h1 - h0;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      const hue = (h0 + diff * frac + 360) % 360;
      return `hsl(${hue.toFixed(1)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;
    };
  }

  function makeContrastPalette(rand) {
    const schemes = [
      [0, 180],
      [0, 120, 240],
      [0, 150, 210],
      [0, 90, 180, 270],
    ];
    const scheme = schemes[Math.floor(rand() * schemes.length)];
    const base = rand() * 360;
    const sat = 70 + rand() * 25;
    const colors = scheme.map((offset, i) => {
      const hue = (base + offset) % 360;
      const light = 42 + (i % 2) * 16 + rand() * 8;
      return `hsl(${hue.toFixed(1)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;
    });
    return function (t) {
      t = wrapT(t);
      const idx = Math.floor(t * colors.length) % colors.length;
      return colors[idx];
    };
  }

  const COLOR_MODE = { GRADIENT: 'gradient', CONTRAST: 'contrast' };

  const canvas = document.getElementById('flow-field');
  const ctx = canvas.getContext('2d');
  let W, H, DPR;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  let particles = [];
  let noise, rand, gradient, contrastPalette, colorMode = COLOR_MODE.GRADIENT;
  let speed, scale, curl, count, fadeAlpha, lifeMax, colorDrift, t0;

  const els = {
    speed: document.getElementById('ff-speed'),
    curl: document.getElementById('ff-curl'),
    scale: document.getElementById('ff-scale'),
    fade: document.getElementById('ff-fade'),
    life: document.getElementById('ff-life'),
    count: document.getElementById('ff-count'),
  };
  const outs = {
    speed: document.getElementById('ff-speed-out'),
    curl: document.getElementById('ff-curl-out'),
    scale: document.getElementById('ff-scale-out'),
    fade: document.getElementById('ff-fade-out'),
    life: document.getElementById('ff-life-out'),
    count: document.getElementById('ff-count-out'),
  };

  const ranges = {
    speed:  { min: 0.05, max: 2.5 },
    curl:   { min: 0.3,  max: 6 },
    scale:  { min: 0.0008, max: 0.01 },
    fade:   { min: 0.005, max: 0.15 },
    life:   { min: 10, max: 400 },
    count:  { min: 100, max: 2000 },
  };

  function toSlider(key, value) {
    return (value - ranges[key].min) / (ranges[key].max - ranges[key].min);
  }

  function fromSlider(key, value) {
    return ranges[key].min + value * (ranges[key].max - ranges[key].min);
  }

  function syncOuts() {
    Object.keys(outs).forEach(key => {
      outs[key].textContent = parseFloat(els[key].value).toFixed(2);
    });
  }

  function spawnParticle(p) {
    p.x = rand() * W;
    p.y = rand() * H;
    p.life = rand() * lifeMax;
  }

  function rebuildParticles() {
    const target = Math.floor(fromSlider('count', els.count.value));
    if (particles.length > target) {
      particles.length = target;
    } else {
      while (particles.length < target) {
        const p = { x: 0, y: 0, life: 0 };
        spawnParticle(p);
        particles.push(p);
      }
    }
  }

  function randomSeed() {
    return Math.floor(Math.random() * 0xffffffff);
  }

  function initFromSeed(seedNum) {
    rand = mulberry32(seedNum);
    noise = makeNoise2D(rand);

    scale = 0.0025 + rand() * 0.004;
    speed = 0.5 + rand() * 1.0;
    curl = 1.5 + rand() * 3.5;
    count = 500 + Math.floor(rand() * 500);
    fadeAlpha = 0.05;
    lifeMax = 60;
    gradient = makeGradient(rand);
    contrastPalette = makeContrastPalette(rand);
    colorDrift = 0.02 + rand() * 0.08;
    t0 = performance.now();

    if (els.speed) {
      els.speed.value = toSlider('speed', speed);
      els.curl.value = toSlider('curl', curl);
      els.scale.value = toSlider('scale', scale);
      els.fade.value = toSlider('fade', fadeAlpha);
      els.life.value = toSlider('life', lifeMax);
      els.count.value = toSlider('count', count);
      syncOuts();
    }

    particles = [];
    for (let i = 0; i < count; i++) {
      const p = { x: 0, y: 0, life: 0 };
      spawnParticle(p);
      particles.push(p);
    }

    ctx.fillStyle = '#0b0b0d';
    ctx.fillRect(0, 0, W, H);
  }

  function step() {
    ctx.fillStyle = `rgba(11,11,13,${fadeAlpha})`;
    ctx.fillRect(0, 0, W, H);

    const elapsed = (performance.now() - t0) / 1000;
    const colorFn = colorMode === COLOR_MODE.CONTRAST ? contrastPalette : gradient;

    for (const p of particles) {
      const n = noise(p.x * scale, p.y * scale);
      const angle = n * Math.PI * curl;
      const nx = p.x + Math.cos(angle) * speed;
      const ny = p.y + Math.sin(angle) * speed;

      const t = (n + 1) / 2 + elapsed * colorDrift;
      ctx.strokeStyle = colorFn(t);
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      ctx.stroke();

      p.x = nx;
      p.y = ny;
      p.life -= 1;

      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H || p.life <= 0) {
        spawnParticle(p);
      }
    }
    requestAnimationFrame(step);
  }

  function bindControls() {
    const rerollBtn = document.getElementById('ff-reroll');
    if (rerollBtn) rerollBtn.addEventListener('click', () => initFromSeed(randomSeed()));

    if (els.speed) {
      els.speed.addEventListener('input', () => { speed = fromSlider('speed', els.speed.value); syncOuts(); });
      els.curl.addEventListener('input', () => { curl = fromSlider('curl', els.curl.value); syncOuts(); });
      els.scale.addEventListener('input', () => { scale = fromSlider('scale', els.scale.value); syncOuts(); });
      els.fade.addEventListener('input', () => { fadeAlpha = fromSlider('fade', els.fade.value); syncOuts(); });
      els.life.addEventListener('input', () => { lifeMax = fromSlider('life', els.life.value); syncOuts(); });
      els.count.addEventListener('input', () => {
        count = Math.floor(fromSlider('count', els.count.value));
        rebuildParticles();
        syncOuts();
      });
    }

    const gradBtn = document.getElementById('ff-mode-gradient');
    const conBtn = document.getElementById('ff-mode-contrast');
    function setColorMode(mode) {
      colorMode = mode;
      if (gradBtn) gradBtn.classList.toggle('active', mode === COLOR_MODE.GRADIENT);
      if (conBtn) conBtn.classList.toggle('active', mode === COLOR_MODE.CONTRAST);
    }
    if (gradBtn) gradBtn.addEventListener('click', () => setColorMode(COLOR_MODE.GRADIENT));
    if (conBtn) conBtn.addEventListener('click', () => setColorMode(COLOR_MODE.CONTRAST));
    setColorMode(COLOR_MODE.GRADIENT);
  }

  function initToggle() {
    const toggle = document.getElementById('ff-toggle');
    const panel = document.getElementById('ff-panel');
    if (!toggle || !panel) return;

    let open = false;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      open = !open;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Hide flow field controls' : 'Show flow field controls');
    });
  }

  window.addEventListener('resize', resize);
  resize();
  initFromSeed(randomSeed());
  requestAnimationFrame(step);
  bindControls();
  initToggle();
})();
