/* Umber landing: the "develop" sequence.
   A plain iPhone photo is developed step by step in WebGL: color (a tone map fitted from the
   real Umber frame of the same subject), grain, and halation. The last step crossfades to the
   real frame Umber produced. */
(() => {
  'use strict';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const dev = document.querySelector('#develop');
  if (!dev) return;

  // Decide the layout (pinned or not) before anything loads, so the page never jumps.
  const hasGL = (() => { try { return !!document.createElement('canvas').getContext('webgl'); } catch { return false; } })();
  if (!hasGL) return;
  document.documentElement.classList.add('gl');

  const VERT = `
attribute vec2 aPos; varying vec2 vUv;
void main(){ vUv = aPos*.5+.5; gl_Position = vec4(aPos,0.,1.); }`;

  const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImg, uLut;
uniform vec2 uRes; uniform float uImgA, uFrame;
uniform float uColor, uGrain, uGlow;

float hash(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
float luma(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }

vec2 cover(vec2 uv){
  float ca=uRes.x/uRes.y;
  vec2 s = ca>uImgA ? vec2(1., uImgA/ca) : vec2(ca/uImgA, 1.);
  return (uv-.5)*s+.5;
}
vec3 grade(vec3 c){
  return vec3(texture2D(uLut, vec2(c.r*(255./256.)+.5/256., .5)).r,
              texture2D(uLut, vec2(c.g*(255./256.)+.5/256., .5)).g,
              texture2D(uLut, vec2(c.b*(255./256.)+.5/256., .5)).b);
}

void main(){
  vec2 uv=cover(vUv);
  vec3 raw=texture2D(uImg, uv).rgb;
  vec3 col=mix(raw, grade(raw), uColor);

  /* Halation: bright areas bleed a red-orange glow into darker neighbours */
  if(uGlow>0.){
    float h=0.;
    for(int i=0;i<16;i++){
      float fi=float(i);
      float a=fi*2.39996;
      float r=.006+.0024*fi;
      vec2 o=vec2(cos(a),sin(a))*r*vec2(1.,uImgA);
      float l=luma(texture2D(uImg, uv+o).rgb);
      h+=smoothstep(.72,.98,l)*(1.-fi/18.);
    }
    h/=9.;
    float edge=1.-smoothstep(.55,.95,luma(raw));
    col+=uGlow*vec3(1.,.28,.12)*h*(.25+.75*edge)*.55;
    col+=uGlow*vec3(1.,.85,.7)*h*h*.08;
  }

  /* Grain: frame-locked, peaks in the midtones, faintly chromatic */
  vec2 gp=floor(gl_FragCoord.xy/1.5)+uFrame*vec2(17.31,41.73);
  float n=hash(gp)+hash(gp+11.1)-1.;
  vec3 nc=vec3(n)+.22*vec3(hash(gp+3.),hash(gp+5.),hash(gp+7.))-.11;
  float lw=1.-pow(abs(luma(col)-.45)*1.6,2.);
  col+=nc*uGrain*(.03+.055*max(lw,0.));

  col+=(hash(gl_FragCoord.xy)-.5)/255.;
  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

  /* Per-channel histogram match: maps the plain photo's tones onto the real Umber frame's. */
  function fitLut(src, ref) {
    const W = 180, H = 240;
    const px = img => { const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
    const a = px(src), b = px(ref), lut = new Uint8Array(256 * 4);
    for (let ch = 0; ch < 3; ch++) {
      const ha = new Float64Array(256), hb = new Float64Array(256);
      for (let i = ch; i < a.length; i += 4) { ha[a[i]]++; hb[b[i]]++; }
      for (let i = 1; i < 256; i++) { ha[i] += ha[i - 1]; hb[i] += hb[i - 1]; }
      let j = 0;
      for (let v = 0; v < 256; v++) {
        const t = ha[v] / ha[255];
        while (j < 255 && hb[j] / hb[255] < t) j++;
        lut[v * 4 + ch] = j;
      }
    }
    const out = new Uint8Array(256 * 4); // light smoothing so the curve can't band
    for (let v = 0; v < 256; v++) {
      for (let ch = 0; ch < 3; ch++) {
        let s = 0, n = 0;
        for (let k = -3; k <= 3; k++) { const q = v + k; if (q >= 0 && q < 256) { s += lut[q * 4 + ch]; n++; } }
        out[v * 4 + ch] = Math.round(s / n);
      }
      out[v * 4 + 3] = 255;
    }
    return out;
  }

  class Develop {
    constructor(canvas, img, lut) {
      this.canvas = canvas;
      this.scale = Math.min(devicePixelRatio || 1, 1.5);
      const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
      if (!gl) throw new Error('no webgl');
      this.gl = gl;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(pr); gl.useProgram(pr);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = (unit, upload) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); upload(); };
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      tex(0, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img));
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      tex(1, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut));
      this.u = {};
      ['uImg', 'uLut', 'uRes', 'uImgA', 'uFrame', 'uColor', 'uGrain', 'uGlow'].forEach(n => this.u[n] = gl.getUniformLocation(pr, n));
      gl.uniform1i(this.u.uImg, 0); gl.uniform1i(this.u.uLut, 1);
      gl.uniform1f(this.u.uImgA, img.naturalWidth / img.naturalHeight);
      this.state = { color: 0, grain: 0, glow: 0 };
      this.t0 = performance.now();
    }
    fit() {
      const r = this.canvas.getBoundingClientRect();
      const W = Math.max(1, Math.round(r.width * this.scale)), H = Math.max(1, Math.round(r.height * this.scale));
      if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
      this.gl.viewport(0, 0, W, H);
    }
    draw() {
      const { gl, u, state: s } = this;
      const t = (performance.now() - this.t0) / 1000;
      gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform1f(u.uFrame, reduceMotion.matches ? 0 : Math.floor(t * 24) % 997);
      gl.uniform1f(u.uColor, s.color); gl.uniform1f(u.uGrain, s.grain); gl.uniform1f(u.uGlow, s.glow);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  const clamp01 = v => Math.min(1, Math.max(0, v));
  const ease = v => v * v * (3 - 2 * v);
  const seg = (p, a, b) => ease(clamp01((p - a) / (b - a)));

  const canvas = dev.querySelector('canvas');
  const rawImg = dev.querySelector('img[data-raw]');
  const realImg = dev.querySelector('img[data-real]');
  const steps = [...dev.querySelectorAll('[data-step]')];
  const chips = [...dev.querySelectorAll('[data-goto]')];
  const meters = ['color', 'grain', 'glow'].map(k => dev.querySelector(`[data-meter=${k}]`));
  const STAGES = [0, .22, .44, .66, .9];
  let film = null;
  let manual = reduceMotion.matches ? 3 : null;
  const pinned = () => !reduceMotion.matches && getComputedStyle(dev).getPropertyValue('--pinned').trim() !== '0';

  const progress = () => {
    if (manual !== null) return STAGES[manual] + .01;
    const r = dev.getBoundingClientRect();
    return clamp01(-r.top / Math.max(1, r.height - innerHeight));
  };

  const apply = () => {
    const p = progress();
    const c = seg(p, .12, .32), g = seg(p, .34, .54), w = seg(p, .56, .76), pr = seg(p, .84, .98);
    if (film) Object.assign(film.state, { color: c, grain: g, glow: w });
    meters.forEach((m, i) => m && m.style.setProperty('--v', [c, g, w][i]));
    dev.style.setProperty('--print', pr);
    dev.classList.toggle('is-real', p >= .8);
    dev.classList.toggle('is-print', pr > .5);
    const idx = p < .12 ? 0 : p < .34 ? 1 : p < .56 ? 2 : p < .8 ? 3 : 4;
    steps.forEach((s, i) => s.toggleAttribute('data-active', i === idx));
    chips.forEach((b, i) => b.setAttribute('aria-pressed', String(i === idx)));
  };

  /* Draw loop: only while on screen; 24 fps is all grain needs */
  let visible = false, last = 0, raf = 0;
  const tick = now => {
    raf = 0;
    if (!visible) return;
    if (now - last >= 1000 / 24) { last = now; apply(); film && film.draw(); }
    if (!reduceMotion.matches) raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
  const redraw = () => { last = 0; kick(); };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) redraw(); }).observe(dev);
  addEventListener('scroll', kick, { passive: true });

  chips.forEach((btn, i) => btn.addEventListener('click', () => {
    if (!pinned()) { manual = i; redraw(); return; }
    manual = null;
    scrollTo({ top: dev.offsetTop + (dev.offsetHeight - innerHeight) * (STAGES[i] + .02), behavior: 'smooth' });
  }));

  /* Start WebGL once the photos are near the viewport */
  const start = async () => {
    try {
      [rawImg, realImg].forEach(i => { i.loading = 'eager'; });
      await Promise.all([rawImg.decode(), realImg.decode()]);
      film = new Develop(canvas, rawImg, fitLut(rawImg, realImg));
      new ResizeObserver(() => { film.fit(); redraw(); }).observe(canvas);
      dev.classList.add('is-live');
      film.fit(); redraw();
    } catch (e) {
      console.warn('Umber develop preview unavailable:', e);
    }
  };
  const near = new IntersectionObserver(([e]) => { if (e.isIntersecting) { near.disconnect(); start(); } }, { rootMargin: '1200px' });
  near.observe(dev);
})();
