/* p8.js -- the tiny fantasy-console runtime the game draws and sings through.
 *
 * Three things live here: a 128x128 indexed framebuffer with its own
 * rasterisers, a 3x5 bitmap font, and a chiptune synthesiser driven by short
 * sound strings like "s1<<x5c2gc3".
 *
 * Deliberately a classic script, not a module, so index.html also works when
 * you just double-click it off the filesystem.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- palette
  var PALETTE = [
    [0x00, 0x00, 0x00], [0x1d, 0x2b, 0x53], [0x7e, 0x25, 0x53], [0x00, 0x87, 0x51],
    [0xab, 0x52, 0x36], [0x5f, 0x57, 0x4f], [0xc2, 0xc3, 0xc7], [0xff, 0xf1, 0xe8],
    [0xff, 0x00, 0x4d], [0xff, 0xa3, 0x00], [0xff, 0xec, 0x27], [0x00, 0xe4, 0x36],
    [0x29, 0xad, 0xff], [0x83, 0x76, 0x9c], [0xff, 0x77, 0xa8], [0xff, 0xcc, 0xaa],
    // Two past the standard sixteen, for the HUD only.
    [0x9b, 0x1b, 0x30],   // 16  velvet red  -- lives
    [0xff, 0xd7, 0x00]    // 17  bright gold -- cash
  ];

  // ------------------------------------------------------------------- font
  // 3x5 glyphs, one 3-bit value per row, MSB = leftmost pixel.
  // Uppercase letters are short small-caps (blank top row) and lowercase are
  // the full-height capitals, which is backwards from what you'd expect and
  // exactly what makes small pixel text readable at this size.
  var FONT = {
    ' ': [0, 0, 0, 0, 0], '!': [2, 2, 2, 0, 2], '"': [5, 5, 0, 0, 0], '#': [5, 7, 5, 7, 5],
    '$': [7, 6, 3, 7, 2], '%': [5, 1, 2, 4, 5], '&': [6, 6, 3, 5, 7], "'": [2, 4, 0, 0, 0], '(': [2, 4, 4, 4, 2],
    ')': [2, 1, 1, 1, 2], '*': [5, 2, 7, 2, 5], '+': [0, 2, 7, 2, 0], ',': [0, 0, 0, 2, 4],
    '-': [0, 0, 7, 0, 0], '.': [0, 0, 0, 0, 2], '/': [1, 2, 2, 2, 4],
    '0': [7, 5, 5, 5, 7], '1': [6, 2, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 3, 1, 7],
    '4': [5, 5, 7, 1, 1], '5': [7, 4, 7, 1, 7], '6': [4, 4, 7, 5, 7], '7': [7, 1, 1, 1, 1],
    '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 1],
    ':': [0, 2, 0, 2, 0], ';': [0, 2, 0, 2, 4], '<': [1, 2, 4, 2, 1], '=': [0, 7, 0, 7, 0],
    '>': [4, 2, 1, 2, 4], '?': [7, 1, 3, 0, 2], '^': [2, 5, 0, 0, 0], '_': [0, 0, 0, 0, 7],
    '`': [2, 1, 0, 0, 0], '[': [6, 4, 4, 4, 6], '\\': [4, 2, 2, 2, 1], ']': [3, 1, 1, 1, 3],
    '{': [3, 2, 6, 2, 3], '|': [2, 2, 2, 2, 2], '}': [6, 2, 3, 2, 6],
    // small caps
    'A': [0, 3, 5, 7, 5], 'B': [0, 6, 6, 5, 7], 'C': [0, 3, 4, 4, 3], 'D': [0, 6, 5, 5, 6],
    'E': [0, 7, 6, 4, 3], 'F': [0, 7, 6, 4, 4], 'G': [0, 3, 4, 5, 7], 'H': [0, 5, 5, 7, 5],
    'I': [0, 7, 2, 2, 7], 'J': [0, 7, 2, 2, 6], 'K': [0, 5, 6, 5, 5], 'L': [0, 4, 4, 4, 3],
    'M': [0, 7, 7, 5, 5], 'N': [0, 6, 5, 5, 5], 'O': [0, 3, 5, 5, 6], 'P': [0, 3, 5, 7, 4],
    'Q': [0, 2, 5, 6, 3], 'R': [0, 6, 5, 6, 5], 'S': [0, 3, 4, 1, 6], 'T': [0, 7, 2, 2, 2],
    'U': [0, 5, 5, 5, 3], 'V': [0, 5, 5, 7, 2], 'W': [0, 5, 5, 7, 7], 'X': [0, 5, 2, 2, 5],
    'Y': [0, 5, 7, 1, 6], 'Z': [0, 7, 1, 4, 7],
    // full-height capitals
    'a': [7, 5, 7, 5, 5], 'b': [7, 5, 6, 5, 7], 'c': [3, 4, 4, 4, 3], 'd': [6, 5, 5, 5, 7],
    'e': [7, 4, 6, 4, 7], 'f': [7, 4, 6, 4, 4], 'g': [3, 4, 4, 5, 7], 'h': [5, 5, 7, 5, 5],
    'i': [7, 2, 2, 2, 7], 'j': [7, 2, 2, 2, 6], 'k': [5, 5, 6, 5, 5], 'l': [4, 4, 4, 4, 7],
    'm': [7, 7, 5, 5, 5], 'n': [6, 5, 5, 5, 5], 'o': [3, 5, 5, 5, 6], 'p': [7, 5, 7, 4, 4],
    'q': [3, 5, 5, 6, 3], 'r': [7, 5, 6, 5, 5], 's': [3, 4, 7, 1, 6], 't': [7, 2, 2, 2, 2],
    'u': [5, 5, 5, 5, 3], 'v': [5, 5, 5, 7, 2], 'w': [5, 5, 5, 7, 7], 'x': [5, 5, 2, 5, 5],
    'y': [5, 5, 7, 1, 7], 'z': [7, 1, 2, 4, 7]
  };

  // -------------------------------------------------------------- framebuffer
  var W = 128, H = 128;
  var fb = new Uint8Array(W * H);      // palette indices
  var camX = 0, camY = 0;              // camera offset
  var lineX = null, lineY = null;      // line() continuation point

  function flr(v) { return Math.floor(v); }

  function pset(x, y, c) {
    x = flr(x) - camX; y = flr(y) - camY;
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    fb[y * W + x] = c;
  }

  function hspan(x0, x1, y, c) {
    y = flr(y) - camY;
    if (y < 0 || y >= H) return;
    x0 = flr(x0) - camX; x1 = flr(x1) - camX;
    if (x0 < 0) x0 = 0;
    if (x1 > W - 1) x1 = W - 1;
    var row = y * W;
    for (var x = x0; x <= x1; x++) fb[row + x] = c;
  }

  function cls(c) { fb.fill(c || 0); }
  function camera(x, y) { camX = flr(x || 0); camY = flr(y || 0); }

  // line() keeps the previous endpoint so polylines are cheap to draw: call it
  // with no arguments to lift the pen, then line(x, y, col) for each point.
  function line() {
    var n = arguments.length;
    if (n === 0) { lineX = lineY = null; return; }
    if (n <= 3) {                                   // line(x, y, [col])
      var nx = arguments[0], ny = arguments[1], c = arguments[2];
      if (lineX !== null) bresenham(lineX, lineY, nx, ny, c);
      lineX = nx; lineY = ny;
      return;
    }
    bresenham(arguments[0], arguments[1], arguments[2], arguments[3], arguments[4]);
    lineX = arguments[2]; lineY = arguments[3];
  }

  function bresenham(x0, y0, x1, y1, c) {
    x0 = flr(x0); y0 = flr(y0); x1 = flr(x1); y1 = flr(y1);
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    var err = dx + dy;
    for (;;) {
      pset(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // Midpoint circle, plotted eight octants at a time.
  function circ(cx, cy, r, c) {
    cx = flr(cx); cy = flr(cy); r = flr(r);
    if (r < 0) return;
    var x = r, y = 0, d = 1 - r;
    while (y <= x) {
      pset(cx + x, cy + y, c); pset(cx - x, cy + y, c);
      pset(cx + x, cy - y, c); pset(cx - x, cy - y, c);
      pset(cx + y, cy + x, c); pset(cx - y, cy + x, c);
      pset(cx + y, cy - x, c); pset(cx - y, cy - x, c);
      y++;
      if (d <= 0) d += 2 * y + 1;
      else { x--; d += 2 * (y - x) + 1; }
    }
  }

  function circfill(cx, cy, r, c) {
    cx = flr(cx); cy = flr(cy); r = flr(r);
    if (r < 0) return;
    var x = r, y = 0, d = 1 - r;
    while (y <= x) {
      hspan(cx - x, cx + x, cy + y, c);
      hspan(cx - x, cx + x, cy - y, c);
      hspan(cx - y, cx + y, cy + x, c);
      hspan(cx - y, cx + y, cy - x, c);
      y++;
      if (d <= 0) d += 2 * y + 1;
      else { x--; d += 2 * (y - x) + 1; }
    }
  }

  function rectfill(x0, y0, x1, y1, c) {
    y0 = flr(y0); y1 = flr(y1);
    for (var y = y0; y <= y1; y++) hspan(x0, x1, y, c);
  }

  function rect(x0, y0, x1, y1, c) {
    hspan(x0, x1, y0, c);
    hspan(x0, x1, y1, c);
    for (var y = flr(y0); y <= flr(y1); y++) { pset(x0, y, c); pset(x1, y, c); }
  }

  // print() with two inline control codes: \6w doubles the width of everything
  // after it and \6t doubles the height. The score uses both.
  function print(str, x, y, c) {
    str = '' + str;
    var wide = 1, tall = 1;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === '\x06') {                       // control code
        var cmd = str[++i];
        if (cmd === 'w') wide = 2;
        else if (cmd === 't') tall = 2;
        continue;
      }
      var g = FONT[ch];
      if (g) {
        for (var row = 0; row < 5; row++) {
          var bits = g[row];
          for (var col = 0; col < 3; col++) {
            if (!(bits & (4 >> col))) continue;
            for (var sy = 0; sy < tall; sy++)
              for (var sx = 0; sx < wide; sx++)
                pset(x + col * wide + sx, y + row * tall + sy, c);
          }
        }
      }
      x += 4 * wide;
    }
  }

  // ------------------------------------------------------------------- maths
  // Angles are turns, 0..1, running clockwise. sin() is negated so a positive
  // angle turns the same way screen coordinates do and nothing needs flipping.
  var TAU = Math.PI * 2;
  function p8cos(a) { return Math.cos(a * TAU); }
  function p8sin(a) { return -Math.sin(a * TAU); }
  function p8atan2(dx, dy) { var a = Math.atan2(-dy, dx) / TAU; return a - Math.floor(a); }
  function rnd(n) { return Math.random() * (n === undefined ? 1 : n); }

  // each() lets you del() the current item from inside the loop without
  // skipping the one after it, which the orb and core loops both rely on.
  function all(t) {
    var i = 0;
    return {
      next: function () {
        if (i >= t.length) return { done: true };
        var v = t[i];
        this._v = v;
        return { done: false, value: v };
      },
      advance: function () { if (t[i] === this._v) i++; }
    };
  }
  function each(t, fn) {
    var i = 0;
    while (i < t.length) {
      var v = t[i];
      fn(v);
      if (t[i] === v) i++;
    }
  }
  function del(t, v) { var i = t.indexOf(v); if (i >= 0) t.splice(i, 1); }

  // ------------------------------------------------------------------ screen
  function Screen(canvas) {
    var ctx = canvas.getContext('2d', { alpha: false });
    var img = ctx.createImageData(W, H);
    var px = new Uint32Array(img.data.buffer);
    var lut = new Uint32Array(PALETTE.length);
    for (var i = 0; i < PALETTE.length; i++) {
      var p = PALETTE[i];
      lut[i] = (255 << 24) | (p[2] << 16) | (p[1] << 8) | p[0];   // little-endian RGBA
    }
    ctx.imageSmoothingEnabled = false;
    return {
      flip: function () {
        for (var i = 0; i < fb.length; i++) px[i] = lut[fb[i]];
        ctx.putImageData(img, 0, 0);
      }
    };
  }

  // ------------------------------------------------------------------- audio
  // The sound-string language. Every effect in the game is one of these.
  //   sN  speed (ticks per note)   iN  instrument   vN  volume   xN  effect
  //   <   volume - 1               >   volume + 1
  //   a..g [#|-] [octave]          .   rest
  // Values are a single character: 0-9 = 0..9, a-z = 10..35.
  var TICK = 183 / 22050;                 // one tick, ~8.3ms -- the whole clock
  var SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

  function charVal(ch) {
    if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
    if (ch >= 'a' && ch <= 'z') return ch.charCodeAt(0) - 87;
    return 0;
  }

  function parseSfx(str) {
    var speed = 16, vol = 5, fx = 0, inst = 5, octave = 3, notes = [], i = 0;
    while (i < str.length) {
      var ch = str[i];
      if (ch === 's') { speed = charVal(str[++i]); i++; }
      else if (ch === 'i') { inst = charVal(str[++i]); i++; }
      else if (ch === 'v') { vol = charVal(str[++i]); i++; }
      else if (ch === 'x') { fx = charVal(str[++i]); i++; }
      else if (ch === '<') { vol = Math.max(0, vol - 1); i++; }
      else if (ch === '>') { vol = Math.min(7, vol + 1); i++; }
      else if (ch === '.') { notes.push({ pitch: -1, vol: 0, fx: fx, inst: inst }); i++; }
      else if (ch in SEMI) {
        var semi = SEMI[ch]; i++;
        if (str[i] === '#') { semi++; i++; }
        else if (str[i] === '-') { semi--; i++; }
        if (str[i] >= '0' && str[i] <= '7') { octave = +str[i]; i++; }
        notes.push({ pitch: octave * 12 + semi, vol: vol, fx: fx, inst: inst });
      } else i++;
    }
    return { speed: Math.max(1, speed), notes: notes };
  }

  // Eight oscillators, as functions of phase in [0,1).
  function osc(inst, t, noise) {
    t -= Math.floor(t);
    switch (inst) {
      case 0: return (Math.abs(t * 2 - 1) - 0.5) * 1.4;                  // triangle
      case 1: return (t < 0.875 ? t * 16 / 7 : (1 - t) * 16) - 1;        // tilted saw
      case 2: return 0.653 * (t * 2 - 1);                                // saw
      case 3: return t < 0.5 ? 0.7 : -0.7;                               // square
      case 4: return t < 0.3125 ? 0.7 : -0.7;                            // pulse
      case 6: return noise;                                              // noise
      case 7: return ((Math.abs(((t * 2) % 2) - 1) - 0.5)
                    + (Math.abs(((t * 1.9) % 2) - 1) - 0.5) * 0.5) * 1.2; // phaser
      default: {                                                         // 5: organ
        var x = t * 4;
        return (Math.abs((x % 2) - 1) - 0.5
              + (Math.abs(((x * 0.5) % 2) - 1) - 0.5) / 2 - 0.1) * 1.4;
      }
    }
  }

  function hz(pitch) { return 440 * Math.pow(2, (pitch - 33) / 12); }

  // Render a sound string into a mono AudioBuffer.
  function renderSfx(ctx, str) {
    var sfx = parseSfx(str);
    var notes = sfx.notes;
    if (!notes.length) return null;
    var rate = ctx.sampleRate;
    var perNote = Math.max(1, Math.round(sfx.speed * TICK * rate));
    var tail = Math.round(0.02 * rate);                 // let the last note ring out
    var buf = ctx.createBuffer(1, notes.length * perNote + tail, rate);
    var out = buf.getChannelData(0);
    var phase = 0, noise = 0, prevPitch = notes[0].pitch;

    for (var n = 0; n < notes.length; n++) {
      var note = notes[n];
      var base = n * perNote;
      var amp0 = note.vol / 7;
      // arpeggio effects cycle the group of four notes this one belongs to
      var group = notes.slice(Math.floor(n / 4) * 4, Math.floor(n / 4) * 4 + 4);
      for (var s = 0; s < perNote; s++) {
        var u = s / perNote;                            // 0..1 through the note
        var pitch = note.pitch, amp = amp0;
        switch (note.fx) {
          case 1: pitch = prevPitch + (note.pitch - prevPitch) * u; break;   // slide
          case 2: pitch += Math.sin(u * perNote / rate * TAU * 7) * 0.5; break; // vibrato
          case 3: pitch = note.pitch * (1 - u); break;                       // drop
          case 4: amp *= u; break;                                           // fade in
          case 5: amp *= 1 - u; break;                                       // fade out
          case 6: case 7: {                                                  // arpeggio
            var step = Math.floor(s / (rate * TICK * (note.fx === 6 ? 2 : 4)));
            var g = group[step % group.length];
            if (g) pitch = g.pitch;
            break;
          }
        }
        if (note.pitch < 0) { out[base + s] = 0; continue; }
        var f = hz(pitch);
        phase += f / rate;
        if (note.inst === 6 && (s & 3) === 0) noise = Math.random() * 2 - 1;
        out[base + s] = osc(note.inst, phase, noise) * amp * 0.55;
      }
      prevPitch = note.pitch;
    }
    // ring-out plus a short de-click ramp at both ends
    var last = notes.length * perNote;
    for (var t2 = 0; t2 < tail; t2++) out[last + t2] = out[last - 1] * (1 - t2 / tail);
    var ramp = Math.min(48, Math.floor(perNote / 2));
    for (var a = 0; a < ramp; a++) {
      out[a] *= a / ramp;
      out[out.length - 1 - a] *= a / ramp;
    }
    return buf;
  }

  // Pre-renders every distinct sound string on first use, then fires them as
  // one-shot buffer sources -- no allocation or latency during play.
  function Audio() {
    var ctx = null, gain = null, cache = {}, muted = false;
    function ensure() {
      if (!ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        gain = ctx.createGain();
        gain.gain.value = 0.8;
        gain.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    return {
      unlock: ensure,
      get muted() { return muted; },
      toggleMute: function () {
        muted = !muted;
        if (gain) gain.gain.value = muted ? 0 : 0.8;
        return muted;
      },
      play: function (str) {
        if (muted) return;
        if (!ensure()) return;
        var buf = cache[str];
        if (buf === undefined) buf = cache[str] = renderSfx(ctx, str);
        if (!buf) return;
        var src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(gain);
        src.start();
      }
    };
  }

  global.P8 = {
    W: W, H: H, fb: fb, PALETTE: PALETTE, FONT: FONT,
    cls: cls, camera: camera, line: line, circ: circ, circfill: circfill,
    rect: rect, rectfill: rectfill, print: print, pset: pset,
    cos: p8cos, sin: p8sin, atan2: p8atan2, rnd: rnd, flr: flr,
    each: each, all: all, del: del,
    Screen: Screen, Audio: Audio, renderSfx: renderSfx, parseSfx: parseSfx
  };
})(this);
