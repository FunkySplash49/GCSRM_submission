/* game.js -- the rules.
 *
 * You drift inside a circle. The ship fires by itself, always at the middle.
 * A shot that misses hits the far wall, turns red, and comes back worth double
 * and lethal to you. Red rings kill on contact. That is the entire game, and
 * the tuning below is what makes it feel like anything.
 */
(function (global) {
  'use strict';

  var P = global.P8;
  var cos = P.cos, sin = P.sin, atan2 = P.atan2, rnd = P.rnd;
  var each = P.each, del = P.del;
  var min = Math.min, max = Math.max, abs = Math.abs, sqrt = Math.sqrt, flr = Math.floor;
  function add(t, v) { t.push(v); return v; }

  // ------------------------------------------------------------------ sounds
  // Every sound in the game is one of these strings, rendered by the synth in
  // p8.js. Read them left to right:
  //   s = speed (ticks per note)   x = effect (5 = fade out)
  //   < and > = volume down / up one   then the notes, a-g with an octave digit
  // Instrument defaults to 5 (organ) and volume to 5.
  var SFX = {
    spawn:   's1<<x5c2gc3',      // a core appears
    die:     's3>>x5g2dc1c0',    // you are hit
    burnout: 's1<<x5f2c1',       // a charged orb hits the wall a second time
    charge:  's1<<x5ge',         // an orb hits the wall and charges up
    kill200: 's3>>x5cgc4c1c0',   // charged kill
    kill100: 's3>>x5g2dc1c0',    // plain kill
    fire:    's1<<x5f4c4',       // you fire
    start:   's3>>x5c2gc3'       // new game
  };
  var audio = P.Audio();
  function sfx(s) { audio.play(s); }

  // ------------------------------------------------------------------- state
  var player, cores, orbs, fx;
  var shake, score, wave, waveTimer, toSpawn, fireInterval, spawnTimer, fireTimer;
  var playing = false;

  // ------------------------------------------------------------------ helpers

  // Clamp to the arena circle (radius 58 - margin). If it clamped, reflect any
  // velocity off the wall and hand back the contact angle.
  function wall(o, margin) {
    var x = o.x, y = o.y, R = 58 - margin;
    var l = y * y + x * x;
    if (l > R * R) {
      var k = R / sqrt(l);
      if (o.vx !== undefined) {
        var dot = 2 * (o.vx * x + o.vy * y) / l;
        o.vx -= x * dot;
        o.vy -= y * dot;
      }
      o.x = x * k;
      o.y = y * k;
      return atan2(x, y);
    }
    return null;
  }

  function dist2(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

  // Drop a core somewhere at least 48px from the player.
  function spawnCore() {
    var x, y;
    do {
      var a = rnd(), d = rnd(52);
      y = sin(a) * d;
      x = cos(a) * d;
    } while (dist2(player, { x: x, y: y }) <= 2304);
    var drift = rnd();
    add(fx, { x: x, y: y, life: 2 });
    shake += 1;
    add(cores, { x: x, y: y, vx: cos(drift) * 0.25, vy: sin(drift) * 0.25 });
    sfx(SFX.spawn);
  }

  //
  function nextWave() {
    wave += 1;
    waveTimer = max(5, 25 - wave) * 60;
    toSpawn = min(wave, 4);
    fireInterval = max(12, 25 - wave) * 5;
    spawnTimer = (2 - wave) * 60;
  }

  //
  function reset() {
    fireTimer = 120;
    wave = 0;
    cores = [];
    orbs = [];
    nextWave();
    player = { x: 0, y: 32 };
    score = 0;
    fx = [];
    shake = 0;
  }

  //
  function die() {
    add(fx, { x: player.x, y: player.y, life: 2 });
    shake += 6;
    playing = false;
    sfx(SFX.die);
  }

  // ------------------------------------------------------------------- input
  // One bit per button: 0 left, 1 right, 2 up, 3 down, 4 start.
  // btnState is what's held right now; btnHit latches anything pressed since
  // the last step so a tap shorter than one frame can never be swallowed.
  var btnState = 0, btnHit = 0;
  var KEYS = {
    ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1,
    ArrowUp: 2, KeyW: 2, ArrowDown: 3, KeyS: 3,
    KeyZ: 4, KeyC: 4, KeyN: 4, Space: 4, Enter: 4
  };
  function btn(i) { return (btnState >> i & 1) !== 0; }
  function btnp(i) { return (btnHit >> i & 1) !== 0; }
  function press(bit) { btnState |= 1 << bit; btnHit |= 1 << bit; }
  function release(bit) { btnState &= ~(1 << bit); }

  // --------------------------------------------------------------- game step
  // One step: simulate, then draw. Called exactly 60 times a second.
  function step() {
    // effects
    each(fx, function (e) {
      if (e.points) e.y -= 0.25;
      e.life -= 1;
      if (e.life === 0) del(fx, e);
    });
    shake -= min(0.125, shake);

    if (playing) {
      // ---- movement: 1px/frame in one of eight directions
      var dx = (btn(1) ? 1 : 0) - (btn(0) ? 1 : 0);
      var dy = (btn(3) ? 1 : 0) - (btn(2) ? 1 : 0);
      if (dx * dx + dy * dy > 0) {
        var a = atan2(dx, dy);
        player.x += cos(a);
        player.y += sin(a);
        wall(player, 3);
      }

      // ---- staggered core spawns
      spawnTimer -= 1;
      if (toSpawn > 0 && spawnTimer <= 0) { spawnCore(); toSpawn -= 1; spawnTimer = 30; }

      // ---- cores drift, bounce, and kill on contact
      each(cores, function (c) {
        c.x += c.vx;
        c.y += c.vy;
        wall(c, 3);
        if (dist2(c, player) < 32) die();
      });

      // ---- orbs
      each(orbs, function (o) {
        o.x += o.vx;
        o.y += o.vy;
        var hit = wall(o, 1);
        if (hit !== null) {
          add(fx, { angle: hit, life: 120 });        // ripple in the wall
          shake += 0.5;
          if (o.charged) {
            sfx(SFX.burnout);
            del(orbs, o);
          } else {
            sfx(SFX.charge);
            o.charged = true;
          }
        } else if (o.charged && dist2(o, player) < 32) {
          die();
          del(orbs, o);
        } else {
          for (var i = 0; i < cores.length; i++) {
            var c = cores[i];
            if (dist2(o, c) < 32) {
              del(orbs, o);
              del(cores, c);
              var points = 100;
              if (o.charged) { points = 200; sfx(SFX.kill200); }
              else sfx(SFX.kill100);
              score += points;
              add(fx, { x: c.x, y: c.y, life: 2 });
              shake += 3;
              add(fx, { x: c.x, y: c.y - 4, points: points, life: 40 });
              break;
            }
          }
        }
      });

      // ---- the ship fires itself, always straight at dead center
      fireTimer -= 1;
      if (fireTimer <= 0) {
        var aim = atan2(-player.x, -player.y);
        add(orbs, { x: player.x, y: player.y, vx: cos(aim) * 3, vy: sin(aim) * 3 });
        shake += 0.5;
        fireTimer = fireInterval;
        sfx(SFX.fire);
      }

      // ---- waves
      waveTimer -= 1;
      if (toSpawn + cores.length === 0) { fireTimer = 120; waveTimer = min(waveTimer, 60); }
      if (waveTimer === 0) nextWave();
    }

    draw();

    if (!playing && btnp(4)) {
      playing = true;
      reset();
      add(fx, { x: player.x, y: player.y, life: 2 });
      shake += 3;
      sfx(SFX.start);
    }
    btnHit = 0;
  }

  // ------------------------------------------------------------------- draw
  var RING_STEP = 524 / 65536;     // ~0.008 of a turn: 126 points around the wall

  function draw() {
    P.camera(rnd(shake) - rnd(shake) - 64, rnd(shake) - rnd(shake) - 64);
    P.cls();

    var s = '' + score;
    P.print('\x06w\x06t' + s, -s.length * 4, -5, 1);

    if (playing) {                                  // the ship: a triangle
      P.line();
      var a = atan2(-player.x, -player.y);
      var pts = [0, 0.375, -0.375, 0];
      for (var i = 0; i < 4; i++)
        P.line(player.x + cos(a + pts[i]) * 4, player.y + sin(a + pts[i]) * 4, 7);
    }

    for (var i = 0; i < orbs.length; i++)
      P.circfill(orbs[i].x, orbs[i].y, 1, orbs[i].charged ? 8 : 7);
    for (var i = 0; i < cores.length; i++)
      P.circ(cores[i].x, cores[i].y, 3, 8);

    // The wall. A closed polyline of 126 points at radius 58, bent by every
    // live effect: each ripple is a wavelet whose centre creeps .002 turns per
    // frame away from its impact angle, with amplitude life/30.
    P.line();
    for (var t = 0; t <= 1; t += RING_STEP) {
      var r = 58;
      for (var j = 0; j < fx.length; j++) {
        var e = fx[j];
        var d = abs(t - (e.angle !== undefined ? e.angle : e.x));
        d = min(d, 1 - d);
        d = d - 0.002 * (120 - e.life);
        if (abs(d + 0.125) < 0.14) r += cos(d / 0.08) * e.life / 30;
      }
      P.line(cos(t) * r + 0.5, sin(t) * r, 7);
    }

    for (var i = 0; i < fx.length; i++) {
      var e = fx[i];
      if (e.points) P.print('+' + e.points, -8 + e.x, e.y, flr(e.points / 32) + 4);
      else if (e.y !== undefined) P.circfill(e.x, e.y, 5, 7);
    }
  }

  // --------------------------------------------------------------- the shell
  function boot() {
    var canvas = document.getElementById('screen');
    var screen = P.Screen(canvas);
    reset();
    playing = false;

    // ---- keyboard
    global.addEventListener('keydown', function (ev) {
      if (ev.code === 'KeyM') { setMuted(audio.toggleMute()); return; }
      var b = KEYS[ev.code];
      if (b === undefined) return;
      ev.preventDefault();
      press(b);
      audio.unlock();
    });
    global.addEventListener('keyup', function (ev) {
      var b = KEYS[ev.code];
      if (b === undefined) return;
      ev.preventDefault();
      release(b);
    });
    global.addEventListener('blur', function () { btnState = 0; });

    // ---- touch: anywhere on the screen is a virtual eight-way stick, and the
    // first touch of a drag doubles as the O button so a tap starts a game.
    var originX = 0, originY = 0, touching = false;
    function dirFromDrag(x, y) {
      var dx = x - originX, dy = y - originY;
      var len = Math.sqrt(dx * dx + dy * dy);
      btnState &= ~0x0f;
      if (len < 12) return;
      var oct = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
      var map = [[1], [1, 3], [3], [0, 3], [0], [0, 2], [2], [1, 2]];
      var bits = map[((oct % 8) + 8) % 8];
      for (var i = 0; i < bits.length; i++) btnState |= 1 << bits[i];
    }
    canvas.addEventListener('touchstart', function (ev) {
      ev.preventDefault();
      audio.unlock();
      var t = ev.changedTouches[0];
      originX = t.clientX; originY = t.clientY;
      touching = true;
      press(4);
    }, { passive: false });
    canvas.addEventListener('touchmove', function (ev) {
      ev.preventDefault();
      if (!touching) return;
      release(4);
      dirFromDrag(ev.changedTouches[0].clientX, ev.changedTouches[0].clientY);
    }, { passive: false });
    function endTouch(ev) {
      ev.preventDefault();
      touching = false;
      btnState &= ~0x1f;
    }
    canvas.addEventListener('touchend', endTouch, { passive: false });
    canvas.addEventListener('touchcancel', endTouch, { passive: false });

    // ---- mute button
    var muteBtn = document.getElementById('mute');
    function setMuted(m) {
      muteBtn.textContent = m ? 'sound off' : 'sound on';
      muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
    }
    muteBtn.addEventListener('click', function () {
      audio.unlock();
      setMuted(audio.toggleMute());
    });

    // ---- fixed 60Hz, however fast the display runs
    var acc = 0, last = performance.now();
    (function frame(now) {
      requestAnimationFrame(frame);
      acc += Math.min(now - last, 250);        // never try to catch up more than 15 steps
      last = now;
      var ran = false;
      while (acc >= 1000 / 60) { acc -= 1000 / 60; step(); ran = true; }
      if (ran) screen.flip();
    })(last);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(this);
