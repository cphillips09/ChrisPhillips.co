/*
 * fx-image.js: WebGL image reveal + hover zoom-blur pulse.
 * Usage: wrap an image in <div class="fx-frame"> and add data-fx to the <img>.
 *   <div class="fx-frame"><img src="images/chris.jpg" alt="..." data-fx></div>
 * The <img> stays in the page for accessibility/SEO; a canvas draws on top of it.
 * Falls back to the plain image (with a CSS fade) if WebGL is unavailable or the
 * visitor prefers reduced motion.
 */
(function () {
  'use strict';

  // Tune the effect here
  var CFG = {
    showDuration: 1500,   // ms fade-in when the image scrolls into view
    blurStrength: 0.2,    // how far the radial blur smears (0–1)
    blurDuration: 1000,   // ms for one hover pulse
    blurPeak: 0.25,       // fraction of the pulse spent ramping up
    pulseOnReveal: true,  // also play one pulse as the image appears
    hoverDelay: 100       // ms before a hover counts (avoids flicker on fly-overs)
  };

  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var VS =
    'attribute vec2 a;varying vec2 v;' +
    'void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}';

  // Radial blur toward the center, same approach as the reference site
  var FS =
    'precision highp float;varying vec2 v;' +
    'uniform sampler2D t;uniform vec2 uCover;uniform float uBlur;uniform float uAlpha;' +
    'float rnd(vec2 c){float d=dot(c,vec2(12.9898,78.233));return fract(sin(mod(d,3.14159))*43758.5453);}' +
    'void main(){' +
    ' vec2 dir=(vec2(.5)-v)*uBlur;float o=rnd(v);vec4 col=vec4(0.);float tot=0.;' +
    ' for(float i=0.;i<6.;i++){' +
    '  float p=(i+o)/6.;float w=4.*(p-p*p);' +
    '  vec2 uv=(v+dir*p-.5)*uCover+.5;' +
    '  col+=texture2D(t,uv)*w;tot+=w;}' +
    ' gl_FragColor=(col/tot)*uAlpha;}';

  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
  function easeInSine(x) { return 1 - Math.cos((x * Math.PI) / 2); }
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function blurAt(p) {
    var e = CFG.blurPeak;
    return p <= e ? easeOutCubic(p / e) : easeInSine(1 - (p - e) / (1 - e));
  }

  function FxImage(img) {
    this.img = img;
    this.frame = img.closest('.fx-frame') || img.parentElement;
    this.alpha = 0;
    this.showStart = null;
    this.pulseStart = null;
    this.raf = 0;
    this.visible = false;
    if (!this.initGL()) { this.fallback(); return; }
    this.bind();
  }

  FxImage.prototype.fallback = function () {
    this.frame.classList.add('fx-fallback');
  };

  FxImage.prototype.initGL = function () {
    var c = document.createElement('canvas');
    c.className = 'fx-canvas';
    c.setAttribute('aria-hidden', 'true');
    var gl = c.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) return false;

    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    }
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return false;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.img);
    } catch (e) {
      return false; // e.g. a cross-origin image without CORS headers
    }

    this.canvas = c;
    this.gl = gl;
    this.u = {
      cover: gl.getUniformLocation(prog, 'uCover'),
      blur: gl.getUniformLocation(prog, 'uBlur'),
      alpha: gl.getUniformLocation(prog, 'uAlpha')
    };
    this.frame.appendChild(c);
    this.frame.classList.add('fx-ready');
    this.resize();
    return true;
  };

  FxImage.prototype.resize = function () {
    var r = this.frame.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    // object-fit: cover math
    var ea = r.width / r.height, ia = this.img.naturalWidth / this.img.naturalHeight;
    this.cover = ea > ia ? [1, ia / ea] : [ea / ia, 1];
    this.draw(this.lastBlur || 0);
  };

  FxImage.prototype.draw = function (blur) {
    var gl = this.gl;
    this.lastBlur = blur;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.u.cover, this.cover[0], this.cover[1]);
    gl.uniform1f(this.u.blur, CFG.blurStrength * blur);
    gl.uniform1f(this.u.alpha, this.alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  FxImage.prototype.loop = function () {
    var self = this;
    if (this.raf) return;
    var tick = function (now) {
      self.raf = 0;
      var running = false, blur = 0;

      if (self.showStart !== null) {
        var sp = clamp((now - self.showStart) / CFG.showDuration);
        self.alpha = easeOutCubic(sp);
        if (sp < 1) running = true; else self.showStart = null;
      }
      if (self.pulseStart !== null) {
        var pp = clamp((now - self.pulseStart) / CFG.blurDuration);
        blur = blurAt(pp);
        if (pp < 1) running = true; else self.pulseStart = null;
      }

      self.draw(blur);
      if (running) self.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };

  FxImage.prototype.reveal = function () {
    if (this.visible) return;
    this.visible = true;
    var now = performance.now();
    this.showStart = now;
    if (CFG.pulseOnReveal) this.pulseStart = now;
    this.loop();
  };

  FxImage.prototype.pulse = function () {
    if (!this.visible || this.pulseStart !== null) return; // let a pulse finish first
    this.pulseStart = performance.now();
    this.loop();
  };

  FxImage.prototype.bind = function () {
    var self = this, timer = 0;
    var trigger = this.img.closest('a, .card, .project') || this.frame;

    trigger.addEventListener('mouseenter', function () {
      timer = setTimeout(function () { self.pulse(); }, CFG.hoverDelay);
    });
    trigger.addEventListener('mouseleave', function () { clearTimeout(timer); });
    trigger.addEventListener('touchstart', function () { self.pulse(); }, { passive: true });

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { self.reveal(); io.disconnect(); } });
      }, { threshold: 0.2 });
      io.observe(this.frame);
    } else {
      this.reveal();
    }

    if ('ResizeObserver' in window) {
      new ResizeObserver(function () { self.resize(); }).observe(this.frame);
    } else {
      window.addEventListener('resize', function () { self.resize(); });
    }
  };

  function attach(img) {
    if (img._fx) return;
    img._fx = true;
    var frame = img.closest('.fx-frame') || img.parentElement;
    if (reduceMotion) { frame.classList.add('fx-fallback'); return; }
    var start = function () { new FxImage(img); };
    if (img.complete && img.naturalWidth) start();
    else img.addEventListener('load', start, { once: true });
  }

  function init() {
    document.querySelectorAll('img[data-fx]').forEach(attach);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
