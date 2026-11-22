/* ops-hero.js — Operations page hero: real estate operations pieces swirl,
 * then on hover / tap / keyboard focus they blur (same radial blur as fx-image.js)
 * and assemble into a house: Leads, Listings, Leverage as the foundation,
 * systems and people as the walls, growth as the roof, AI at the peak.
 *
 * Markup:
 *   <div class="ops-hero" tabindex="0" role="img" aria-label="...">
 *     <canvas class="oh-2d" aria-hidden="true"></canvas>
 *     <canvas class="oh-gl" aria-hidden="true"></canvas>
 *   </div>
 * Load with defer. Styles live in site.css (search "Operations hero").
 * Edit the labels / rows in PIECES below.
 * Low power: the loop sleeps once the house is built, pauses off-screen and in
 * hidden tabs, and WebGL only runs during the 1 s blur pulse.
 * Reduced motion (or ?static on the URL): shows the finished house, no motion.
 */
(() => {
  /* ---------- Config (blur values match fx-image.js) ---------- */
  const CFG = {
    blurStrength: 0.2,   // same as fx-image.js
    blurDuration: 1000,  // same as fx-image.js
    blurPeak: 0.25,      // same as fx-image.js
    hoverDelay: 100,     // same as fx-image.js
    pulseOnReveal: true,
    pulseOnLeave: false, // set true if you want a blur on the way back out too
    assembleMs: 950,     // how long the pieces take to build the house
    scatterMs: 1500,     // how long they take to drift back into the swirl
    stagger: 0.03        // per-piece delay (fraction of the morph)
  };

  /* ---------- Content: label, group, row in the finished structure ---------- */
  // Row 0 = peak (AI), 1-2 = roof (growth), 3-4 = walls (how the business runs), 5 = foundation
  const PIECES = [
    ['AI', 'peak', 0],
    ['Marketing', 'grow', 1], ['Recruiting', 'grow', 1],
    ['Transactions', 'grow', 2], ['Accounting', 'grow', 2],
    ['CRM', 'run', 3], ['Automation', 'run', 3], ['Data & scoreboards', 'run', 3],
    ['Onboarding', 'run', 4], ['Training', 'run', 4], ['Accountability', 'run', 4],
    ['Leads', 'base', 5], ['Listings', 'base', 5], ['Leverage', 'base', 5]
  ];
  const ROW_Y = [104, 154, 202, 280, 332, 410];
  // Roof = neutral, walls = sage, AI (peak) and foundation = warm accent, so top and bottom tie together
  const COLOR = { peak: [224, 153, 109], grow: [238, 240, 236], run: [127, 184, 165], base: [224, 153, 109] };

  /* ---------- Scene geometry (logical units, scaled to the canvas) ---------- */
  const W = 420, H = 525, CX = 210, CY = 262;
  const PILL_H = 30, GAP = 8, FONT = '500 13px Inter, system-ui, sans-serif';
  // Foundation pieces once they lock in: bigger, solid warm accent
  const BASE_H = 36, BASE_GAP = 10, BASE_FONT = '500 15px Inter, system-ui, sans-serif';
  const SERIF_FONT = '600 15px Fraunces, Georgia, serif';
  const EDGE_FADE = 48;   // px over which swirling pieces fade out near the edges

  const frame = document.querySelector('.ops-hero');
  if (!frame) return;
  const c2 = frame.querySelector('.oh-2d');
  const cg = frame.querySelector('.oh-gl');
  const ctx = c2.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || location.search.includes('static');

  /* ---------- Seeded random so the swirl looks the same every load ---------- */
  let seed = 7;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeIn = t => t * t * t;

  let pieces = [];

  function buildPieces() {
    const N = PIECES.length;
    // Even vertical spread for the vortex, shuffled so groups are mixed in the swirl
    const heights = PIECES.map((_, i) => -180 + i * (360 / (N - 1))).sort(() => rnd() - 0.5);
    pieces = PIECES.map(([label, group, row], i) => {
      const isBase = group === 'base';
      ctx.font = FONT;
      const w = Math.ceil(ctx.measureText(label).width) + 36;          // regular pill: padding + dot
      ctx.font = BASE_FONT;
      const bw = Math.ceil(ctx.measureText(label).width) + 40;         // foundation pill once locked in
      return {
        label, group, row, w, bw, isBase,
        phase: (i / N) * Math.PI * 2 + rnd() * 0.6,
        speed: 0.18 + rnd() * 0.14,           // radians / second
        yb: heights[i],                       // height within the vortex
        bob: rnd() * Math.PI * 2,
        tx: 0, ty: ROW_Y[row]
      };
    });
    // Target positions: center each row
    ROW_Y.forEach((_, r) => {
      const rowPieces = pieces.filter(p => p.row === r);
      const gap = r === 5 ? BASE_GAP : GAP;
      const width = p => p.isBase ? p.bw : p.w;
      const total = rowPieces.reduce((s, p) => s + width(p), 0) + gap * (rowPieces.length - 1);
      let x = CX - total / 2;
      rowPieces.forEach(p => { p.tx = x + width(p) / 2; x += width(p) + gap; });
    });
    // Build order: foundation first, roof last (reverses naturally on scatter)
    const order = [...pieces].sort((a, b) => b.row - a.row || a.tx - b.tx);
    order.forEach((p, k) => { p.delay = k * CFG.stagger; });
  }

  /* ---------- Swirl position for a piece at a given time ---------- */
  function swirl(p, time) {
    const a = p.phase + time * p.speed;
    const top = (p.yb + 180) / 360;          // 0 at top, 1 at bottom
    const rx = 175 - top * 85;               // wider at the top: a soft funnel
    const depth = Math.sin(a);               // -1 back, +1 front
    return {
      x: CX + Math.cos(a) * rx,
      y: CY + p.yb + depth * 22 + Math.sin(time * 0.7 + p.bob) * 6,
      s: 0.74 + 0.3 * (depth + 1) / 2,
      alpha: 0.4 + 0.6 * (depth + 1) / 2,
      rot: Math.cos(a) * 0.22,
      z: depth
    };
  }

  /* ---------- Drawing ---------- */
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawBackground() {
    ctx.clearRect(0, 0, W, H);   // transparent: the page background shows through
  }

  function drawOutline(a) {
    if (a <= 0) return;
    ctx.save();
    ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(127,184,165,${0.4 * a})`;
    ctx.beginPath(); ctx.moveTo(10, 232); ctx.lineTo(CX, 30); ctx.lineTo(410, 232); ctx.stroke(); // roof
    ctx.beginPath(); ctx.moveTo(30, 240); ctx.lineTo(30, 372); ctx.lineTo(390, 372); ctx.lineTo(390, 240); ctx.stroke(); // walls
    // Foundation: a filled slab with a stronger edge, so it reads as solid ground
    roundRect(18, 384, 384, 52, 12);
    ctx.fillStyle = `rgba(12,15,13,${0.55 * a})`; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(224,153,109,${0.55 * a})`; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(34, 384); ctx.lineTo(386, 384);          // brighter top edge, like a lit ledge
    ctx.lineWidth = 2; ctx.strokeStyle = `rgba(224,153,109,${0.9 * a})`; ctx.stroke();
    ctx.font = SERIF_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(163,170,165,${0.9 * a})`;
    ctx.fillText('One system. Everything works.', CX, 482);
    ctx.restore();
  }

  function drawPiece(p, st, e) {
    // Foundation pieces look like every other piece in the swirl and only
    // change once they've landed (last 35% of their move)
    const k = p.isBase ? easeOut(clamp((e - 0.65) / 0.35)) : 0;
    if (k < 1) drawRegular(p, st, st.alpha * (1 - k));
    if (k > 0) drawFoundation(p, st, st.alpha * k);
  }

  function drawFoundation(p, st, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(st.x, st.y); ctx.rotate(st.rot); ctx.scale(st.s, st.s);
    roundRect(-p.bw / 2, -BASE_H / 2, p.bw, BASE_H, BASE_H / 2);
    ctx.fillStyle = '#e0996d'; ctx.fill();
    if (shine > 0 && shine < 1) {                       // one light sweep when the house finishes
      ctx.save(); ctx.clip();
      const x = lerp(-p.bw / 2 - 60, p.bw / 2 + 60, shine);
      const g = ctx.createLinearGradient(x - 30, 0, x + 30, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,244,234,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(-p.bw / 2, -BASE_H / 2, p.bw, BASE_H);
      ctx.restore();
    }
    ctx.font = BASE_FONT; ctx.fillStyle = '#1f140d'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(p.label, 0, 0.5);
    ctx.restore();
  }

  function drawRegular(p, st, alpha) {
    const [r, g, b] = COLOR[p.group];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(st.x, st.y); ctx.rotate(st.rot); ctx.scale(st.s, st.s);
    roundRect(-p.w / 2, -PILL_H / 2, p.w, PILL_H, PILL_H / 2);
    ctx.fillStyle = 'rgba(20,23,21,0.82)'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${r},${g},${b},${p.group === 'grow' ? 0.3 : 0.55})`; ctx.stroke();
    ctx.beginPath(); ctx.arc(-p.w / 2 + 15, 0, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fill();
    ctx.font = FONT; ctx.fillStyle = '#eef0ec'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(p.label, -p.w / 2 + 24, 0.5);
    ctx.restore();
  }

  function render(m, time) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawBackground();
    drawOutline(easeOut(clamp((m - 0.55) / 0.45)));
    const span = 1 - CFG.stagger * (pieces.length - 1);
    const states = pieces.map(p => {
      const e = easeInOut(clamp((m - p.delay) / span));
      const s = swirl(p, time);
      const st = {
        x: lerp(s.x, p.tx, e), y: lerp(s.y, p.ty, e), s: lerp(s.s, 1, e),
        alpha: lerp(s.alpha, 1, e), rot: lerp(s.rot, 0, e), z: lerp(s.z, 2, e)
      };
      // Fade swirling pieces out before they reach the edge of the box, so it never shows
      const half = p.w / 2 * st.s;
      const room = Math.min(st.x - half, W - st.x - half, st.y - 22, H - st.y - 22);
      st.alpha *= lerp(easeOut(clamp(room / EDGE_FADE)), 1, e);
      return { p, e, st };
    });
    states.sort((a, b) => a.st.z - b.st.z).forEach(({ p, st, e }) => drawPiece(p, st, e));
  }

  /* ---------- WebGL radial blur (same technique as fx-image.js) ---------- */
  let gl = null, uBlur = null, tex = null;
  function initGL() {
    try {
      gl = cg.getContext('webgl', { premultipliedAlpha: true, antialias: false });
      if (!gl) return;
      const vs = 'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
      const fs = `#ifdef GL_FRAGMENT_PRECISION_HIGH
        precision highp float;
        #else
        precision mediump float;
        #endif
        uniform sampler2D tex;uniform float blur;varying vec2 uv;
        float rand(vec2 c){return fract(sin(dot(c,vec2(12.9898,78.233)))*43758.5453);}
        void main(){vec2 dir=(vec2(.5)-uv)*blur;float n=rand(gl_FragCoord.xy);vec4 col=vec4(0.);float tw=0.;
        for(int i=0;i<16;i++){float f=(float(i)+n)/16.;float w=1.-f*.6;col+=texture2D(tex,uv+dir*f)*w;tw+=w;}
        gl_FragColor=col/tw;}`;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog); gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      uBlur = gl.getUniformLocation(prog, 'blur');
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); // blur transparent pixels without dark fringes
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR));
    } catch (e) { gl = null; }
  }
  function drawGL(amount) {
    gl.viewport(0, 0, cg.width, cg.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c2); // 2D scene -> texture
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uBlur, amount);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function pulseAmount(elapsed) {
    const p = elapsed / CFG.blurDuration;
    if (p >= 1) return 0;
    const k = CFG.blurPeak;
    return CFG.blurStrength * (p < k ? easeOut(p / k) : 1 - easeIn((p - k) / (1 - k)));
  }

  /* ---------- State + loop (sleeps whenever nothing is moving) ---------- */
  let scale = 1, m = 0, goal = 0, time = 0, last = 0, raf = 0;
  let visible = false, pulseStart = -1, hoverTimer = 0, revealed = false;
  let shine = 0, shineStart = -1; const SHINE_MS = 750;

  function resize() {
    const rect = frame.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    [c2, cg].forEach(c => { c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr); });
    scale = c2.width / W;
    render(m, time);
  }

  function loop(now) {
    raf = 0;
    const dt = Math.min(64, now - (last || now)); last = now;
    if (!reduced) time += dt / 1000;
    if (m !== goal) {
      const dur = goal > m ? CFG.assembleMs : CFG.scatterMs;
      m = goal > m ? Math.min(goal, m + dt / dur) : Math.max(goal, m - dt / dur);
      if (m === 1 && goal === 1 && !reduced) shineStart = now;      // house just finished
    }
    if (goal !== 1) shineStart = -1;
    shine = shineStart >= 0 ? (now - shineStart) / SHINE_MS : 0;
    if (shine >= 1) { shine = 0; shineStart = -1; }
    render(m, time);
    let pulsing = false;
    if (pulseStart >= 0 && gl) {
      const amt = pulseAmount(now - pulseStart);
      if (amt > 0) { drawGL(amt); pulsing = true; } else { pulseStart = -1; }
    }
    frame.classList.toggle('is-pulsing', pulsing);
    // Fully assembled and no pulse running = a still picture, so stop drawing (zero cost while hovered)
    const settled = (m === 1 && goal === 1) || reduced;
    if (visible && !document.hidden && (!settled || pulsing || shineStart >= 0 || m !== goal)) raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } }

  function pulse() {
    if (reduced || !gl || pulseStart >= 0) return; // like fx-image.js: ignore while one is running
    pulseStart = performance.now(); kick();
  }
  function assemble() { if (goal === 1) return; goal = 1; pulse(); kick(); }
  function scatter() { if (reduced || goal === 0) return; goal = 0; if (CFG.pulseOnLeave) pulse(); kick(); }

  /* ---------- Events ---------- */
  frame.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(assemble, CFG.hoverDelay); });
  frame.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); scatter(); });
  frame.addEventListener('focus', assemble);
  frame.addEventListener('blur', scatter);
  frame.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') (goal === 1 ? scatter : assemble)(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

  /* ---------- Start once Inter is loaded (so text measures correctly) ---------- */
  const fontsReady = document.fonts ? Promise.all([document.fonts.load(FONT), document.fonts.load(BASE_FONT), document.fonts.load(SERIF_FONT)]) : Promise.resolve();
  fontsReady.catch(() => {}).then(() => {
    buildPieces();
    if (reduced) { m = goal = 1; } else { initGL(); }
    resize();
    ('ResizeObserver' in window) ? new ResizeObserver(resize).observe(frame) : addEventListener('resize', resize);
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !revealed) { revealed = true; if (CFG.pulseOnReveal) pulse(); }
      if (visible) kick();
    }, { threshold: 0.2 }).observe(frame);
  });
})();
