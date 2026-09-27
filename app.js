(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const MIN = 30, MAX = 100, SPAN = 60000;
  const fmtTime = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  /* ---------- 설정 ---------- */
  const DEFAULTS = { thr: 70, mode: 'quiet', goalMin: 10, resetOnLoud: false, fuseSec: 30, graceSec: 2, beep: true, msg: '너무 시끄러워요! 목소리를 낮춰 주세요', calib: 0, sim: false, deviceId: '' };
  const cfg = Object.assign({}, DEFAULTS);
  try { const raw = localStorage.getItem('noise-meter-cfg'); if (raw) Object.assign(cfg, JSON.parse(raw)); } catch (e) { }
  function save() { try { localStorage.setItem('noise-meter-cfg', JSON.stringify(cfg)); } catch (e) { } }

  /* ---------- 상태 ---------- */
  const S = {
    screen: 'setup', raw: MIN, level: MIN, hist: [], lastSample: 0,
    mic: null, audio: null, micBusy: false,
    running: false, paused: false, result: null,
    warn: false, aboveSince: null, belowSince: null, warnCount: 0,
    quietMs: 0, remainingMs: 0, fuseMs: 0, elapsedMs: 0, sum: 0, n: 0, sessionMax: 0, resetFlashUntil: 0,
    sim: { phase: 0, until: 0, wob: Math.random() * 100 },
    hover: null
  };
  const PHASES = [
    { base: 42, jit: 3, dur: [9000, 14000] },
    { base: 60, jit: 5, dur: [10000, 16000] },
    { base: 76, jit: 6, dur: [7000, 11000] },
    { base: 58, jit: 5, dur: [8000, 12000] }
  ];
  function simTarget(now) {
    const sm = S.sim;
    if (now > sm.until) { sm.phase = (sm.phase + 1) % PHASES.length; const p = PHASES[sm.phase]; sm.until = now + p.dur[0] + Math.random() * (p.dur[1] - p.dur[0]); }
    const p = PHASES[sm.phase]; sm.wob += 0.013;
    let v = p.base + Math.sin(sm.wob) * p.jit + Math.sin(sm.wob * 2.7) * p.jit * 0.5 + (Math.random() - 0.5) * p.jit * 1.6;
    if (Math.random() < 0.02) v += 8 + Math.random() * 8;
    return clamp(v, MIN, MAX);
  }

  /* ---------- 소리 ---------- */
  function getAudio() { if (!S.audio) S.audio = new (window.AudioContext || window.webkitAudioContext)(); return S.audio; }
  function tone(freq, delay, dur, type, vol) {
    try {
      const ctx = getAudio(); if (ctx.state === 'suspended') ctx.resume();
      const t0 = ctx.currentTime + delay; const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'triangle'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + dur + 0.05);
    } catch (e) { }
  }
  function beep() { if (!cfg.beep) return; tone(660, 0, 0.18); tone(880, 0.22, 0.18); }
  function chime() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.5, 'sine', 0.25)); }
  function boom() {
    try {
      const ctx = getAudio(); if (ctx.state === 'suspended') ctx.resume();
      const len = ctx.sampleRate * 1.2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, ctx.currentTime); f.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 1);
      const g = ctx.createGain(); g.gain.value = 0.8;
      src.connect(f).connect(g).connect(ctx.destination); src.start();
      tone(60, 0, 0.9, 'sine', 0.5);
    } catch (e) { }
  }

  /* ---------- 마이크 ---------- */
  async function startMic(deviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setMicStatus('이 브라우저는 마이크를 지원하지 않아요. 크롬이나 엣지에서 열어 주세요.', true); return false; }
    if (S.micBusy) return false; S.micBusy = true; $('#micBtn').disabled = true;
    try {
      stopMic();
      const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      if (deviceId) audio.deviceId = { exact: deviceId };
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio }); }
      catch (e) { if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) { delete audio.deviceId; cfg.deviceId = ''; stream = await navigator.mediaDevices.getUserMedia({ audio }); } else throw e; }
      const ctx = getAudio(); if (ctx.state === 'suspended') await ctx.resume();
      const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0; src.connect(an);
      S.mic = { stream, src, analyser: an, buf: new Float32Array(an.fftSize) };
      const track = stream.getAudioTracks()[0]; const st = track.getSettings ? track.getSettings() : {};
      if (st.deviceId) cfg.deviceId = st.deviceId; save();
      await fillDevices();
      setMicStatus('마이크 연결됨: ' + (track.label || '기본 마이크') + '. 손뼉을 쳐 보세요.');
      $('#micBtn').textContent = '🎤 마이크 다시 켜기';
      return true;
    } catch (e) {
      const msg = e.name === 'NotAllowedError' ? '마이크 사용이 거부됐어요. 주소창의 자물쇠(또는 마이크) 아이콘을 눌러 허용해 주세요.'
        : e.name === 'NotFoundError' ? '마이크를 찾지 못했어요. 연결을 확인해 주세요.'
          : '마이크를 열 수 없어요. (' + (e.message || e.name) + ')';
      setMicStatus(msg, true); S.mic = null; return false;
    } finally { S.micBusy = false; $('#micBtn').disabled = false; }
  }
  function stopMic() { if (!S.mic) return; try { S.mic.stream.getTracks().forEach(t => t.stop()); S.mic.src.disconnect(); } catch (e) { } S.mic = null; }
  async function fillDevices() {
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
      const sel = $('#micSelect'); sel.innerHTML = '';
      list.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || ('마이크 ' + (i + 1)); sel.appendChild(o); });
      if (cfg.deviceId && list.some(d => d.deviceId === cfg.deviceId)) sel.value = cfg.deviceId;
      sel.hidden = list.length < 2;
    } catch (e) { }
  }
  function setMicStatus(text, err) { const el = $('#micStatus'); el.textContent = text; el.classList.toggle('err', !!err); }
  function micLevel() {
    const a = S.mic.analyser, b = S.mic.buf; a.getFloatTimeDomainData(b);
    let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i];
    const rms = Math.sqrt(s / b.length);
    return clamp(20 * Math.log10(rms || 1e-7) + 100 + cfg.calib, MIN, MAX);
  }

  /* ---------- 설정 화면 바인딩 ---------- */
  function applyCfgToSetup() {
    $('#thr').value = cfg.thr; $('#goalMin').value = cfg.goalMin; $('#resetOnLoud').checked = cfg.resetOnLoud;
    $('#fuseSec').value = cfg.fuseSec; $('#graceSec').value = cfg.graceSec; $('#beep').checked = cfg.beep;
    $('#msg').value = cfg.msg; $('#calib').value = cfg.calib; $('#sim').checked = cfg.sim;
    const r = document.querySelector('input[name=mode][value="' + cfg.mode + '"]'); if (r) r.checked = true;
    refreshSetupLabels();
  }
  function refreshSetupLabels() {
    $('#thrLabel').textContent = cfg.thr + ' dB';
    $('#fuseLabel').textContent = cfg.fuseSec + '초';
    $('#graceLabel').textContent = (cfg.graceSec % 1 ? cfg.graceSec.toFixed(1) : cfg.graceSec) + '초';
    $('#calibLabel').textContent = (cfg.calib > 0 ? '+' : '') + cfg.calib;
    $('#pvThr').style.left = ((cfg.thr - MIN) / (MAX - MIN) * 100) + '%';
    $$('.mode-opts').forEach(el => { el.hidden = !el.dataset.for.split(' ').includes(cfg.mode); });
  }
  function bindSetup() {
    $('#thr').addEventListener('input', e => { cfg.thr = +e.target.value; refreshSetupLabels(); save(); });
    $('#goalMin').addEventListener('change', e => { cfg.goalMin = clamp(Math.round(+e.target.value) || 10, 1, 120); e.target.value = cfg.goalMin; save(); });
    $('#resetOnLoud').addEventListener('change', e => { cfg.resetOnLoud = e.target.checked; save(); });
    $('#fuseSec').addEventListener('input', e => { cfg.fuseSec = +e.target.value; refreshSetupLabels(); save(); });
    $('#graceSec').addEventListener('input', e => { cfg.graceSec = +e.target.value; refreshSetupLabels(); save(); });
    $('#beep').addEventListener('change', e => { cfg.beep = e.target.checked; save(); if (cfg.beep) beep(); });
    $('#msg').addEventListener('input', e => { cfg.msg = e.target.value.trim() || DEFAULTS.msg; save(); });
    $('#calib').addEventListener('input', e => { cfg.calib = +e.target.value; refreshSetupLabels(); save(); });
    $('#sim').addEventListener('change', e => { cfg.sim = e.target.checked; save(); });
    $$('input[name=mode]').forEach(r => r.addEventListener('change', e => { if (e.target.checked) { cfg.mode = e.target.value; refreshSetupLabels(); save(); } }));
    $('#micBtn').addEventListener('click', () => startMic(cfg.deviceId));
    $('#micSelect').addEventListener('change', e => { cfg.deviceId = e.target.value; save(); startMic(cfg.deviceId); });
    $('#startBtn').addEventListener('click', onStart);
  }
  async function onStart() {
    const btn = $('#startBtn'); btn.disabled = true;
    try {
      if (!cfg.sim && !S.mic) {
        const ok = await startMic(cfg.deviceId);
        if (!ok) { toast('마이크를 켜지 못했어요. 위의 안내를 확인하거나 "마이크 없이 시험하기"를 켜 주세요.'); return; }
      }
      try { getAudio().resume(); } catch (e) { }
      startRun();
    } finally { btn.disabled = false; }
  }

  /* ---------- 실행 ---------- */
  function startRun() {
    Object.assign(S, { running: true, paused: false, result: null, warn: false, aboveSince: null, belowSince: null, warnCount: 0, quietMs: 0, elapsedMs: 0, sum: 0, n: 0, sessionMax: 0, resetFlashUntil: 0 });
    S.remainingMs = cfg.goalMin * 60000; S.fuseMs = cfg.fuseSec * 1000;
    $('#overlay').hidden = true; $('#confetti').innerHTML = '';
    $('#run').classList.remove('shake');
    $('#goalQuiet').hidden = cfg.mode !== 'quiet'; $('#goalBomb').hidden = cfg.mode !== 'bomb';
    $('#goalName').textContent = cfg.mode === 'quiet' ? '🌱 ' + cfg.goalMin + '분 동안 조용히 채우기' : cfg.mode === 'bomb' ? '💣 ' + cfg.goalMin + '분 버티면 폭탄 해체' : '📊 소음 측정';
    $('#timerLabel').textContent = cfg.mode === 'quiet' ? '채운 시간' : cfg.mode === 'bomb' ? '해체까지' : '경과';
    $('#quietGoal').textContent = fmtTime(cfg.goalMin * 60000);
    $('#quietHint').textContent = cfg.resetOnLoud ? '조용하면 채워지고, 경고가 뜨면 처음부터 다시!' : '조용하면 채워지고, 시끄러우면 멈춰요';
    $('#alert').textContent = '🤫 ' + cfg.msg;
    $('#pauseBtn').textContent = '⏸ 일시정지'; $('#pausedBadge').hidden = true;
    buildZones();
    showScreen('run');
  }
  function runLogic(now, dt) {
    if (!S.running || S.paused) { S.aboveSince = null; return; }
    S.elapsedMs += dt; S.sum += S.level * dt; S.n += dt; S.sessionMax = Math.max(S.sessionMax, S.level);
    const over = S.level > cfg.thr;
    if (over) {
      S.belowSince = null; if (S.aboveSince == null) S.aboveSince = now;
      if (!S.warn && now - S.aboveSince > cfg.graceSec * 1000) {
        S.warn = true; S.warnCount++; beep();
        if (cfg.mode === 'quiet' && cfg.resetOnLoud && S.quietMs > 0) { S.quietMs = 0; S.resetFlashUntil = now + 2500; }
      }
    } else {
      S.aboveSince = null; if (S.belowSince == null) S.belowSince = now;
      if (S.warn && now - S.belowSince > 1500) S.warn = false;
    }
    if (cfg.mode === 'quiet') {
      if (!over) S.quietMs += dt;
      if (S.quietMs >= cfg.goalMin * 60000) endRun('success');
    } else if (cfg.mode === 'bomb') {
      S.remainingMs -= dt; if (over) S.fuseMs -= dt;
      if (S.fuseMs <= 0) endRun('boom');
      else if (S.remainingMs <= 0) endRun('success');
    } else if (!over) { S.quietMs += dt; }
  }
  function endRun(result) {
    S.running = false; S.result = result; S.warn = false;
    const avg = S.n ? Math.round(S.sum / S.n) : 0;
    $('#rAvg').textContent = avg + ' dB'; $('#rMax').textContent = Math.round(S.sessionMax) + ' dB'; $('#rWarn').textContent = S.warnCount + '회';
    if (result === 'success') {
      $('#rEmoji').textContent = cfg.mode === 'bomb' ? '🎉' : '🌸';
      $('#rTitle').textContent = cfg.mode === 'bomb' ? '폭탄 해체 성공!' : '목표 달성!';
      $('#rDesc').textContent = cfg.goalMin + '분 동안 잘 해냈어요. 경고는 ' + S.warnCount + '번 있었어요.';
      chime(); confetti();
    } else {
      $('#rEmoji').textContent = '💥'; $('#rTitle').textContent = '펑! 폭탄이 터졌어요';
      $('#rDesc').textContent = '도화선이 다 탔어요. ' + fmtTime(cfg.goalMin * 60000 - S.remainingMs) + ' 만에 터졌어요.';
      boom(); $('#run').classList.add('shake');
    }
    $('#overlay').hidden = false;
  }
  function confetti() {
    const box = $('#confetti'); box.innerHTML = '';
    const items = ['🎉', '✨', '🌟', '🎊', '💚', '⭐'];
    for (let i = 0; i < 40; i++) {
      const s = document.createElement('span'); s.textContent = items[i % items.length];
      s.style.left = Math.random() * 100 + '%'; s.style.animationDuration = (2.5 + Math.random() * 2.5) + 's'; s.style.animationDelay = (Math.random() * 1.5) + 's';
      box.appendChild(s);
    }
  }
  function togglePause() {
    if (!S.running) return;
    S.paused = !S.paused;
    $('#pauseBtn').textContent = S.paused ? '▶ 계속하기' : '⏸ 일시정지'; $('#pausedBadge').hidden = !S.paused;
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('전체화면을 열 수 없어요. F11 키를 눌러 보세요.'));
  }
  function showScreen(name) {
    S.screen = name; $('#setup').hidden = name !== 'setup'; $('#run').hidden = name !== 'run';
    if (name === 'setup') { S.running = false; S.paused = false; $('#run').classList.remove('warn'); }
  }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 4500); }

  /* ---------- 게이지 ---------- */
  const CX = 150, CY = 150, R = 112, A0 = -120, A1 = 120, NS = 'http://www.w3.org/2000/svg';
  const rad = d => d * Math.PI / 180;
  const pt = (a, r) => [CX + r * Math.sin(rad(a)), CY - r * Math.cos(rad(a))];
  const angleOf = v => A0 + (clamp(v, MIN, MAX) - MIN) / (MAX - MIN) * (A1 - A0);
  function arc(a0, a1, r) { const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r); return 'M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A' + r + ' ' + r + ' 0 ' + ((a1 - a0) > 180 ? 1 : 0) + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1); }
  function buildZones() {
    const g = $('#zones'); g.innerHTML = '';
    [[MIN, cfg.thr - 10, 'var(--good)'], [cfg.thr - 10, cfg.thr, 'var(--warn)'], [cfg.thr, MAX, 'var(--crit)']].forEach(([a, b, c]) => {
      if (b <= a) return; const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', arc(angleOf(a), angleOf(b), R)); p.setAttribute('stroke', c); p.setAttribute('stroke-width', '18'); p.setAttribute('fill', 'none'); g.appendChild(p);
    });
    const a = angleOf(cfg.thr), [x0, y0] = pt(a, R - 16), [x1, y1] = pt(a, R + 14);
    const m = document.createElementNS(NS, 'path'); m.setAttribute('d', 'M' + x0 + ' ' + y0 + ' L' + x1 + ' ' + y1); m.setAttribute('stroke', 'currentColor'); m.setAttribute('stroke-width', '3'); m.setAttribute('stroke-linecap', 'round'); g.appendChild(m);
  }
  function buildTicks() {
    const g = $('#ticks'); g.innerHTML = '';
    for (let v = MIN; v <= MAX; v += 10) {
      const a = angleOf(v), [x, y] = pt(a, R + 24);
      const t = document.createElementNS(NS, 'text'); t.setAttribute('x', x.toFixed(1)); t.setAttribute('y', (y + 4).toFixed(1)); t.textContent = v; g.appendChild(t);
      const [tx0, ty0] = pt(a, R - 13), [tx1, ty1] = pt(a, R - 9);
      const l = document.createElementNS(NS, 'path'); l.setAttribute('d', 'M' + tx0.toFixed(1) + ' ' + ty0.toFixed(1) + ' L' + tx1.toFixed(1) + ' ' + ty1.toFixed(1)); l.setAttribute('stroke', 'var(--surface)'); l.setAttribute('stroke-width', '2'); g.appendChild(l);
    }
  }

  /* ---------- 그리기 ---------- */
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function status() { return S.level >= cfg.thr ? 'critical' : (S.level >= cfg.thr - 10 ? 'warning' : 'good'); }
  const STATUS_TEXT = { good: '조용해요', warning: '조금 시끄러워요', critical: '너무 시끄러워요' };
  function renderSetup() {
    const live = S.mic || cfg.sim;
    const chip = $('#pvChip');
    if (!live) { $('#pvVal').textContent = '--'; $('#pvFill').style.width = '0%'; chip.className = 'chip'; $('#pvChipText').textContent = '마이크 꺼짐'; return; }
    const st = status(); $('#pvVal').textContent = Math.round(S.level);
    const f = $('#pvFill'); f.style.width = ((S.level - MIN) / (MAX - MIN) * 100) + '%'; f.classList.toggle('over', S.level >= cfg.thr);
    chip.className = 'chip ' + st; $('#pvChipText').textContent = (cfg.sim && !S.mic ? '가짜 소리 · ' : '') + STATUS_TEXT[st];
    $('#thrHint').textContent = '지금 소리 ' + Math.round(S.level) + ' dB. 보통 수업 소리보다 10 정도 높게 잡으면 적당해요.';
  }
  function renderRun(now) {
    const st = status(), lv = Math.round(S.level);
    $('#run').classList.toggle('warn', S.warn && S.running);
    $('#needle').setAttribute('transform', 'rotate(' + angleOf(S.level).toFixed(2) + ' ' + CX + ' ' + CY + ')');
    $('#heroVal').textContent = lv;
    const chip = $('#chip'); chip.className = 'chip ' + st; $('#chipText').textContent = STATUS_TEXT[st];
    $('#avgVal').textContent = S.n ? Math.round(S.sum / S.n) : '–'; $('#maxVal').textContent = S.n ? Math.round(S.sessionMax) : '–';
    $('#warnCount').textContent = S.warnCount; $('#quietTotal').textContent = fmtTime(S.quietMs);
    if (cfg.mode === 'quiet') {
      const goal = cfg.goalMin * 60000, p = clamp(S.quietMs / goal, 0, 1);
      $('#timer').textContent = fmtTime(S.quietMs);
      $('#quietPct').textContent = Math.floor(p * 100) + '%'; $('#quietTime').textContent = fmtTime(S.quietMs);
      $('#quietFill').style.width = (p * 100) + '%'; $('#quietMarker').style.left = (p * 100) + '%';
      $('#quietMarker').textContent = p >= 1 ? '🌸' : p >= 0.66 ? '🌳' : p >= 0.33 ? '🌿' : '🌱';
      const h = $('#quietHint'); const flash = now < S.resetFlashUntil;
      h.classList.toggle('flash', flash); h.textContent = flash ? '경고! 처음부터 다시 채워요' : (cfg.resetOnLoud ? '조용하면 채워지고, 경고가 뜨면 처음부터 다시!' : '조용하면 채워지고, 시끄러우면 멈춰요');
    } else if (cfg.mode === 'bomb') {
      $('#timer').textContent = fmtTime(S.remainingMs); $('#bombTime').textContent = fmtTime(S.remainingMs);
      const p = clamp(S.fuseMs / (cfg.fuseSec * 1000), 0, 1);
      $('#fuseFill').style.width = (p * 100) + '%'; $('#spark').style.left = (p * 100) + '%';
      $('#fuseLeft').textContent = Math.ceil(S.fuseMs / 1000);
      $('#goalBomb').classList.toggle('burning', S.running && !S.paused && S.level > cfg.thr);
    } else {
      $('#timer').textContent = fmtTime(S.elapsedMs);
    }
    drawChart($('#chart'), now);
  }
  function drawChart(cv, now) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const accent = css('--accent'), crit = css('--crit'), ink2 = css('--ink-2'), line = css('--line'), surface = css('--chart');
    const padL = 34, padR = 56, padT = 10, padB = 20, x0 = padL, x1 = w - padR, y0 = padT, y1 = h - padB;
    const X = t => x1 - (now - t) / SPAN * (x1 - x0), Y = v => y1 - (clamp(v, MIN, MAX) - MIN) / (MAX - MIN) * (y1 - y0);
    ctx.font = '11px "Noto Sans KR", system-ui, sans-serif'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.fillStyle = ink2; ctx.textAlign = 'right';
    for (let v = MIN; v <= MAX; v += 10) { const y = Y(v); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.fillText(v, x0 - 6, y); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let s = 0; s <= 60; s += 15) { const x = X(now - s * 1000); ctx.fillText(s === 0 ? '지금' : s + '초 전', x, y1 + 5); }
    ctx.textBaseline = 'middle';
    const pts = S.hist.filter(p => now - p.t <= SPAN + 200); if (pts.length < 2) return;
    const path = () => { ctx.beginPath(); pts.forEach((p, i) => { const x = X(p.t), y = Y(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
    const close = () => { ctx.lineTo(X(pts[pts.length - 1].t), y1); ctx.lineTo(X(pts[0].t), y1); ctx.closePath(); };
    path(); close(); ctx.fillStyle = css('--accent-soft'); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, Math.max(0, Y(cfg.thr) - y0)); ctx.clip(); path(); close(); ctx.fillStyle = css('--crit-soft'); ctx.fill(); ctx.restore();
    path(); ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    const ty = Y(cfg.thr); ctx.setLineDash([5, 4]); ctx.strokeStyle = crit; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0, ty); ctx.lineTo(x1, ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = crit; ctx.textAlign = 'left'; ctx.fillText('제한 ' + cfg.thr, x1 + 6, ty);
    const lp = pts[pts.length - 1], ex = X(lp.t), ey = Y(lp.v);
    ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2); ctx.fillStyle = surface; ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI * 2); ctx.fillStyle = lp.v >= cfg.thr ? crit : accent; ctx.fill();
    if (Math.abs(ey - ty) > 10) { ctx.fillStyle = css('--ink'); ctx.font = '600 12px "Noto Sans KR", system-ui, sans-serif'; ctx.fillText(Math.round(lp.v) + ' dB', x1 + 6, ey); }
    const hx = S.hover;
    if (hx != null && hx >= x0 && hx <= x1) {
      let best = pts[0], bd = 1e9; for (const p of pts) { const d = Math.abs(X(p.t) - hx); if (d < bd) { bd = d; best = p; } }
      const bx = X(best.t), by = Y(best.v);
      ctx.strokeStyle = css('--line-2'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx, y0); ctx.lineTo(bx, y1); ctx.stroke();
      ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fillStyle = surface; ctx.fill(); ctx.beginPath(); ctx.arc(bx, by, 3.5, 0, Math.PI * 2); ctx.fillStyle = accent; ctx.fill();
      const label = Math.round(best.v) + ' dB · ' + Math.round((now - best.t) / 1000) + '초 전';
      ctx.font = '500 11px "Noto Sans KR", system-ui, sans-serif'; const tw = ctx.measureText(label).width + 14;
      let lx = bx + 10; if (lx + tw > x1) lx = bx - 10 - tw; const ly = clamp(by - 24, y0, y1 - 22);
      ctx.fillStyle = css('--ink'); ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(lx, ly, tw, 22, 6); else ctx.rect(lx, ly, tw, 22); ctx.fill();
      ctx.fillStyle = css('--plane'); ctx.textAlign = 'left'; ctx.fillText(label, lx + 7, ly + 11);
    }
  }

  /* ---------- 메인 루프 ---------- */
  // 측정과 타이머는 setInterval(창이 가려져도 돌아감), 그리기는 requestAnimationFrame
  let last = performance.now();
  function logicTick() {
    const now = performance.now();
    const dt = Math.min(5000, now - last); last = now;
    if (S.mic && !cfg.sim) S.raw = micLevel();
    else if (cfg.sim) S.raw = simTarget(now);
    else S.raw = MIN;
    const tau = S.raw > S.level ? 90 : 450;
    S.level += (S.raw - S.level) * (1 - Math.exp(-dt / tau));
    if (now - S.lastSample >= 100) { S.lastSample = now; S.hist.push({ t: now, v: S.level }); while (S.hist.length && now - S.hist[0].t > SPAN + 1000) S.hist.shift(); }
    if (S.screen === 'run') runLogic(now, dt);
  }
  function renderTick(now) {
    if (S.screen === 'run') renderRun(now); else renderSetup();
    requestAnimationFrame(renderTick);
  }

  /* ---------- 시작 ---------- */
  function init() {
    applyCfgToSetup(); bindSetup(); buildTicks(); buildZones();
    $('#pauseBtn').addEventListener('click', togglePause);
    $('#fsBtn').addEventListener('click', toggleFullscreen);
    $('#setupBtn').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); showScreen('setup'); });
    $('#againBtn').addEventListener('click', startRun);
    $('#toSetupBtn').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); showScreen('setup'); });
    const cv = $('#chart');
    cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); S.hover = e.clientX - r.left; });
    cv.addEventListener('pointerleave', () => { S.hover = null; });
    document.addEventListener('keydown', e => {
      if (S.screen !== 'run' || e.target.matches('input,select,textarea')) return;
      if (e.code === 'Space') { e.preventDefault(); togglePause(); }
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    });
    setInterval(logicTick, 50);
    requestAnimationFrame(renderTick);
  }
  init();
})();
