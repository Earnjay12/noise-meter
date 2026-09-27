/* 소음 측정기 효과: 폭탄 장면, 자동차 도로, 축포. 외부 파일 없이 캔버스로 그린다. */
window.FX = (function () {
  'use strict';
  const rnd = (a, b) => a + Math.random() * (b - a);
  const COLORS = ['#ff5e5e', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585', '#ff9f1c', '#8ac926'];
  const FALLBACK = { '--sky-a': '#dceefb', '--sky-b': '#f6fbff', '--ink': '#151b1d', '--good': '#0ca30c', '--crit': '#d03b3b' };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || FALLBACK[n] || '#888';

  // 캔버스를 화면 크기에 맞추고, 논리 좌표(LW x LH)로 그릴 수 있게 변환을 건다.
  // LW가 없으면 높이 LH에 맞춰 폭을 화면 비율대로 늘린다.
  function fit(cv, LW, LH) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    const ctx = cv.getContext('2d');
    const lw = LW || w * LH / h, lh = LH;
    const s = Math.min(pw / lw, ph / lh), ox = (pw - lw * s) / 2, oy = (ph - lh * s) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(s, 0, 0, s, ox, oy);
    return { ctx, lw, lh };
  }

  /* ---------------- 폭탄 ---------------- */
  function BombScene(cv) {
    const BX = 240, BY = 190, BR = 58;
    const B = { sparks: [], fire: [], debris: [], smoke: [], ring: null, flash: 0, shakeT: 0, exploded: false };
    function fusePoint(t) {
      const p0 = [BX + 30, BY - 52], p1 = [BX + 70, BY - 120], p2 = [BX + 140, BY - 90], p3 = [BX + 170, BY - 150];
      const u = 1 - t;
      return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
    }
    function reset() { Object.assign(B, { sparks: [], fire: [], debris: [], smoke: [], ring: null, flash: 0, shakeT: 0, exploded: false }); }
    function explode() {
      if (B.exploded) return;
      B.exploded = true; B.flash = 1; B.shakeT = 1; B.ring = { r: 10, a: 1 };
      for (let i = 0; i < 90; i++) { const a = rnd(0, Math.PI * 2), s = rnd(2, 11); B.fire.push({ x: BX, y: BY, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, r: rnd(10, 26), life: 1, dec: rnd(.012, .03), hue: rnd(10, 50) }); }
      for (let i = 0; i < 26; i++) { const a = rnd(0, Math.PI * 2), s = rnd(4, 13); B.debris.push({ x: BX, y: BY, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, w: rnd(4, 12), h: rnd(3, 8), rot: rnd(0, 6), vr: rnd(-.3, .3), life: 1 }); }
      for (let i = 0; i < 18; i++) { const a = rnd(0, Math.PI * 2), s = rnd(.5, 3); B.smoke.push({ x: BX + rnd(-20, 20), y: BY + rnd(-20, 20), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, r: rnd(14, 30), life: 1, dec: rnd(.006, .012) }); }
    }
    // st: { fuse: 0~1 남은 도화선, burning: 지금 타는 중인지 }
    function draw(dt, st) {
      const f = fit(cv, 480, 300); if (!f) return; const c = f.ctx;
      const fuse = Math.max(0, Math.min(1, st.fuse)), burning = !!st.burning && !B.exploded;
      c.save();
      if (B.shakeT > 0) { B.shakeT = Math.max(0, B.shakeT - dt * 1.6); const k = B.shakeT * 14; c.translate(rnd(-k, k), rnd(-k, k)); }
      c.fillStyle = 'rgba(0,0,0,.12)'; c.beginPath(); c.ellipse(BX, BY + BR + 10, BR * 1.05, 10, 0, 0, Math.PI * 2); c.fill();
      if (!B.exploded) {
        const fear = 1 - fuse;
        const jit = burning ? fear * fear * 9 : fear * fear * 2;
        const jx = rnd(-jit, jit), jy = rnd(-jit, jit);
        c.save(); c.translate(jx, jy);
        // 도화선
        c.lineCap = 'round'; c.lineWidth = 7; c.strokeStyle = '#7a5a3a'; c.beginPath();
        for (let i = 0; i <= 24; i++) { const [x, y] = fusePoint(i / 24 * fuse); i ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.stroke(); c.lineWidth = 3; c.strokeStyle = '#c9a06a'; c.stroke();
        c.fillStyle = '#4a4f53'; c.beginPath(); c.roundRect(BX + 16, BY - 70, 28, 24, 5); c.fill();
        // 몸통
        const g = c.createRadialGradient(BX - 20, BY - 22, 6, BX, BY, BR + 6);
        g.addColorStop(0, '#5b6367'); g.addColorStop(.5, '#2a2f33'); g.addColorStop(1, '#141719');
        c.fillStyle = g; c.beginPath(); c.arc(BX, BY, BR, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,.18)'; c.beginPath(); c.ellipse(BX - 20, BY - 24, 16, 9, -.6, 0, Math.PI * 2); c.fill();
        // 표정: 도화선이 짧을수록 겁먹음
        c.fillStyle = '#fff'; c.beginPath(); c.ellipse(BX - 16, BY - 4, 9, 10 + fear * 4, 0, 0, Math.PI * 2); c.ellipse(BX + 16, BY - 4, 9, 10 + fear * 4, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#151b1d'; c.beginPath(); c.arc(BX - 16 + fear * 3, BY - 2, 4, 0, Math.PI * 2); c.arc(BX + 16 - fear * 3, BY - 2, 4, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#151b1d'; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath();
        if (fear > .5) c.ellipse(BX, BY + 20, 7 + fear * 6, 5 + fear * 8, 0, 0, Math.PI * 2);
        else { c.moveTo(BX - 10, BY + 20); c.quadraticCurveTo(BX, BY + 14 + fear * 14, BX + 10, BY + 20); }
        c.stroke();
        c.restore();
        if (burning) {
          const [fx, fy] = fusePoint(fuse);
          for (let i = 0; i < 4; i++) B.sparks.push({ x: fx + jx, y: fy + jy, vx: rnd(-3, 3), vy: rnd(-4, 1), life: 1, dec: rnd(.03, .07), r: rnd(1.5, 4) });
          const gl = c.createRadialGradient(fx, fy, 0, fx, fy, 26); gl.addColorStop(0, 'rgba(255,230,120,.9)'); gl.addColorStop(1, 'rgba(255,140,0,0)');
          c.fillStyle = gl; c.beginPath(); c.arc(fx, fy, 26, 0, Math.PI * 2); c.fill();
        }
      }
      B.sparks = B.sparks.filter(p => p.life > 0);
      B.sparks.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .12; p.life -= p.dec; c.fillStyle = 'rgba(255,' + Math.round(150 + p.life * 100) + ',40,' + Math.max(0, p.life) + ')'; c.beginPath(); c.arc(p.x, p.y, Math.max(0, p.r * p.life), 0, Math.PI * 2); c.fill(); });
      B.smoke = B.smoke.filter(p => p.life > 0);
      B.smoke.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy -= .02; p.r += .5; p.life -= p.dec; c.fillStyle = 'rgba(90,90,95,' + Math.max(0, p.life * .5) + ')'; c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill(); });
      c.globalCompositeOperation = 'lighter';
      B.fire = B.fire.filter(p => p.life > 0);
      B.fire.forEach(p => { p.x += p.vx; p.y += p.vy; p.vx *= .96; p.vy *= .96; p.life -= p.dec; const r = Math.max(.1, p.r * p.life), a = Math.max(0, p.life); const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); g.addColorStop(0, 'hsla(' + (p.hue + 30) + ',100%,70%,' + a + ')'); g.addColorStop(.6, 'hsla(' + p.hue + ',100%,50%,' + a * .7 + ')'); g.addColorStop(1, 'hsla(' + p.hue + ',100%,40%,0)'); c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill(); });
      c.globalCompositeOperation = 'source-over';
      B.debris = B.debris.filter(p => p.life > 0);
      B.debris.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .35; p.rot += p.vr; p.life -= .012; c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = 'rgba(40,44,48,' + Math.max(0, p.life) + ')'; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); c.restore(); });
      if (B.ring) { B.ring.r += 9; B.ring.a -= .035; if (B.ring.a <= 0) B.ring = null; else { c.strokeStyle = 'rgba(255,255,255,' + B.ring.a + ')'; c.lineWidth = 10 * B.ring.a + 1; c.beginPath(); c.arc(BX, BY, B.ring.r, 0, Math.PI * 2); c.stroke(); } }
      c.restore();
      if (B.flash > 0) { c.fillStyle = 'rgba(255,250,230,' + B.flash + ')'; c.fillRect(-50, -50, f.lw + 100, f.lh + 100); B.flash -= dt * 3; }
    }
    return { draw, explode, reset, get exploded() { return B.exploded; } };
  }

  /* ---------------- 자동차 도로 ---------------- */
  function RoadScene(cv) {
    const H = 260;
    const C = { speed: 0, wheel: 0, road: 0, bob: 0, puffs: [], skid: 0, wasLoud: false, party: [], celebrated: false };
    function reset() { Object.assign(C, { speed: 0, wheel: 0, road: 0, bob: 0, puffs: [], skid: 0, wasLoud: false, party: [], celebrated: false }); }
    function celebrate(w) { for (let i = 0; i < 160; i++) { const a = (90 + rnd(-60, 60)) * Math.PI / 180, s = rnd(6, 16); C.party.push({ x: w - 60, y: H - 120, vx: Math.cos(a) * s, vy: -Math.sin(a) * s, w: rnd(6, 11), h: rnd(4, 7), rot: rnd(0, 6), vr: rnd(-.25, .25), c: COLORS[i % COLORS.length], life: 120 }); } }
    // st: { prog: 0~1, moving: 달리는 중, loud: 시끄러움, done: 도착 }
    function draw(dt, st) {
      const f = fit(cv, null, H); if (!f) return; const c = f.ctx, w = f.lw, h = H;
      const target = st.moving && !st.done ? 1 : 0;
      C.speed += (target - C.speed) * (target > C.speed ? dt * 1.2 : dt * 4);
      if (st.loud && !C.wasLoud && !st.done) C.skid = 1; C.wasLoud = !!st.loud;
      if (st.done && !C.celebrated) { C.celebrated = true; celebrate(w); }
      C.wheel += C.speed * dt * 14; C.road += C.speed * dt * 260; C.bob = Math.sin(performance.now() / 90) * C.speed * 2.2;
      const sky = c.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, css('--sky-a')); sky.addColorStop(1, css('--sky-b'));
      c.fillStyle = sky; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(12,163,12,.25)'; c.beginPath(); c.moveTo(0, h - 90);
      for (let x = 0; x <= w + 40; x += 40) c.lineTo(x, h - 90 - Math.sin((x + C.road * .15) / 90) * 18 - Math.sin((x + C.road * .15) / 37) * 6);
      c.lineTo(w, h); c.lineTo(0, h); c.fill();
      c.fillStyle = '#3a4045'; c.fillRect(0, h - 78, w, 60);
      c.strokeStyle = '#e9e2b0'; c.lineWidth = 4; c.setLineDash([36, 28]); c.lineDashOffset = -(C.road % 64); c.beginPath(); c.moveTo(0, h - 48); c.lineTo(w, h - 48); c.stroke(); c.setLineDash([]);
      const x0 = 70, x1 = w - 90;
      c.font = '28px "Noto Sans KR",system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = css('--ink'); c.fillText('🏁', x1 + 30, h - 84);
      c.fillStyle = 'rgba(21,27,29,.15)'; c.fillRect(x0, h - 100, x1 - x0, 6); c.fillStyle = css('--good'); c.fillRect(x0, h - 100, (x1 - x0) * Math.max(0, Math.min(1, st.prog)), 6);
      const cx = x0 + (x1 - x0) * Math.max(0, Math.min(1, st.prog)), cy = h - 78 + C.bob;
      if (C.speed > .2 && Math.random() < .5) C.puffs.push({ x: cx - 46, y: cy - 6, r: rnd(3, 6), life: 1, vx: -rnd(1.5, 3), vy: -rnd(.2, .8) });
      C.puffs = C.puffs.filter(p => p.life > 0);
      C.puffs.forEach(p => { p.x += p.vx; p.y += p.vy; p.r += .35; p.life -= .03; c.fillStyle = 'rgba(120,125,130,' + Math.max(0, p.life * .5) + ')'; c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill(); });
      if (C.skid > 0) { C.skid -= dt * 1.5; c.strokeStyle = 'rgba(30,30,30,' + Math.max(0, C.skid * .5) + ')'; c.lineWidth = 5; c.beginPath(); c.moveTo(cx - 40, h - 24); c.lineTo(cx - 18, h - 24); c.moveTo(cx + 14, h - 24); c.lineTo(cx + 36, h - 24); c.stroke(); }
      if (C.speed > .6) { c.strokeStyle = 'rgba(21,27,29,.25)'; c.lineWidth = 2; for (let i = 0; i < 3; i++) { const y = cy - 40 + i * 12; c.beginPath(); c.moveTo(cx - 60 - rnd(0, 20), y); c.lineTo(cx - 90 - rnd(0, 30), y); c.stroke(); } }
      c.save(); c.translate(cx, cy);
      c.fillStyle = '#e8503a'; c.beginPath(); c.roundRect(-46, -26, 92, 30, 8); c.fill();
      c.fillStyle = '#f06a55'; c.beginPath(); c.roundRect(-28, -50, 56, 28, 10); c.fill();
      c.fillStyle = '#bfe6ff'; c.beginPath(); c.roundRect(-22, -46, 22, 18, 4); c.roundRect(4, -46, 20, 18, 4); c.fill();
      c.fillStyle = '#fff3b0'; c.beginPath(); c.roundRect(38, -20, 8, 8, 2); c.fill();
      const braking = (st.loud || st.done);
      c.fillStyle = braking ? '#ff2d2d' : '#7a1f1f'; c.beginPath(); c.roundRect(-46, -20, 8, 8, 2); c.fill();
      if (st.loud && !st.done) { const gl = c.createRadialGradient(-44, -16, 0, -44, -16, 18); gl.addColorStop(0, 'rgba(255,60,60,.7)'); gl.addColorStop(1, 'rgba(255,60,60,0)'); c.fillStyle = gl; c.beginPath(); c.arc(-44, -16, 18, 0, Math.PI * 2); c.fill(); }
      [-28, 28].forEach(wx => { c.save(); c.translate(wx, 4); c.rotate(C.wheel); c.fillStyle = '#1d2124'; c.beginPath(); c.arc(0, 0, 13, 0, Math.PI * 2); c.fill(); c.fillStyle = '#9aa3a8'; c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#1d2124'; c.lineWidth = 2; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(i * Math.PI / 2) * 7, Math.sin(i * Math.PI / 2) * 7); c.stroke(); } c.restore(); });
      c.font = '700 16px "Noto Sans KR",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      if (st.loud && !st.done) { c.fillStyle = '#fff'; c.beginPath(); c.roundRect(-4, -92, 68, 30, 10); c.fill(); c.fillStyle = css('--crit'); c.fillText('시끄러워!', 30, -71); }
      else if (st.done) { c.fillStyle = '#fff'; c.beginPath(); c.roundRect(-30, -92, 60, 30, 10); c.fill(); c.fillStyle = css('--good'); c.fillText('도착!', 0, -71); }
      c.restore();
      for (let i = C.party.length - 1; i >= 0; i--) { const p = C.party[i]; p.x += p.vx; p.y += p.vy; p.vy += .3; p.vx *= .985; p.rot += p.vr; p.life--; if (p.life <= 0) { C.party.splice(i, 1); continue; } c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.globalAlpha = Math.min(1, p.life / 25); c.fillStyle = p.c; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); c.restore(); }
    }
    return { draw, reset };
  }

  /* ---------------- 축포 (화면 전체) ---------------- */
  function Confetti(cv) {
    const P = []; let dirty = false, fwEnd = 0;
    function size() { const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; const pw = Math.round(w * dpr), ph = Math.round(h * dpr); if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; } const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, w, h }; }
    // origin은 0~1 비율, angle은 도(90=위)
    function burst(o) {
      o = Object.assign({ count: 120, angle: 90, spread: 70, speed: 14, origin: { x: .5, y: .8 }, scalar: 1, ticks: 110 }, o);
      const w = cv.clientWidth, h = cv.clientHeight;
      for (let i = 0; i < o.count; i++) { const a = (o.angle + rnd(-o.spread / 2, o.spread / 2)) * Math.PI / 180, s = o.speed * rnd(.5, 1.15); P.push({ x: o.origin.x * w, y: o.origin.y * h, vx: Math.cos(a) * s, vy: -Math.sin(a) * s, w: rnd(6, 11) * o.scalar, h: rnd(4, 7) * o.scalar, rot: rnd(0, 6), vr: rnd(-.25, .25), wob: rnd(0, 6), c: COLORS[i % COLORS.length], life: o.ticks, circle: Math.random() < .3 }); }
      dirty = true;
    }
    function celebrate() {
      burst({ count: 180, angle: 90, spread: 80, speed: 16, origin: { x: .5, y: .85 }, scalar: 1.2 });
      setTimeout(() => burst({ count: 90, angle: 60, spread: 55, origin: { x: 0, y: .9 } }), 150);
      setTimeout(() => burst({ count: 90, angle: 120, spread: 55, origin: { x: 1, y: .9 } }), 300);
      fwEnd = performance.now() + 3500;
    }
    function draw() {
      if (performance.now() < fwEnd && Math.random() < .2) burst({ count: 40, angle: 90, spread: 360, speed: 7, ticks: 70, origin: { x: rnd(.15, .85), y: rnd(.15, .5) }, scalar: .8 });
      if (!P.length) { if (dirty) { const { ctx, w, h } = size(); ctx.clearRect(0, 0, w, h); dirty = false; } return; }
      const { ctx, w, h } = size(); ctx.clearRect(0, 0, w, h);
      for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; p.x += p.vx; p.y += p.vy; p.vy += .28; p.vx *= .985; p.vy *= .985; p.rot += p.vr; p.wob += .12; p.life--; if (p.life <= 0 || p.y > h + 20) { P.splice(i, 1); continue; } ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.min(1, p.life / 25); ctx.fillStyle = p.c; const sx = Math.abs(Math.cos(p.wob)); if (p.circle) { ctx.beginPath(); ctx.ellipse(0, 0, p.w / 2 * sx + 1, p.h / 2 + 1, 0, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2 * sx, -p.h / 2, p.w * sx, p.h); ctx.restore(); }
    }
    function clear() { P.length = 0; fwEnd = 0; dirty = true; }
    return { burst, celebrate, draw, clear };
  }

  return { BombScene, RoadScene, Confetti };
})();
