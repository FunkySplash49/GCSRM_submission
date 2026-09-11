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
    start:   's3>>x5c2gc3',      // new game
    coin:    's2<<x5c5'          // one unit of cash crossing into the wallet
  };
  var audio = P.Audio();
  function sfx(s) { audio.play(s); }

  // ------------------------------------------------------------------- state
  var player, cores, orbs, fx;
  var shake, score, wave, waveTimer, toSpawn, fireInterval, spawnTimer, fireTimer;
  var playing = false;

  var LIVES = 3;
  var lives;          // squares still filled, bottom left
  var invuln;         // frames of grace after a hit, or you'd lose all three at once
  var hurtFlash;      // frames the square you just lost keeps blinking
  var cash;           // this run's earnings, score / 100
  var highScore = 0, bank = 0;   // bank is the wallet: every run ever, added up

  // The end card's life, in order: slide in and settle, wait for a button, pay
  // the run's cash into the wallet, then launch back out the way it came.
  var PH_IN = 0, PH_WAIT = 1, PH_CASHOUT = 2, PH_OUT = 3;
  var END_K = 0.16, END_DAMP = 0.68, END_START = -90;
  var END_KICK = -2.4, END_GRAV = 0.6;   // the wind-up, then the slingshot
  var ending, endPhase, panelY, panelVy, panelW;
  var cashAcc, cashStep;

  // Mouse, kept in game coordinates. Only the end card cares.
  var mouseX = 0, mouseY = 0, mouseIn = false, clickWanted = false;
  var hoverBtn = -1;

  // High score and the cash bank outlive the tab. Wrapped because private
  // browsing throws on the first read rather than returning null.
  function load() {
    try {
      highScore = +localStorage.getItem('dc.hi') || 0;
      bank = +localStorage.getItem('dc.bank') || 0;
    } catch (e) { /* no storage, no problem */ }
  }
  function save() {
    try {
      localStorage.setItem('dc.hi', highScore);
      localStorage.setItem('dc.bank', bank);
    } catch (e) { /* ditto */ }
  }

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
    lives = LIVES;
    invuln = 0;
    hurtFlash = 0;
    cash = 0;
    ending = false;
  }

  //
  // Take a hit. Costs one square; the run only ends when the last one goes.
  function hit() {
    if (invuln > 0) return;
    add(fx, { x: player.x, y: player.y, life: 2 });
    shake += 6;
    sfx(SFX.die);
    lives -= 1;
    hurtFlash = 30;
    invuln = 90;
    if (lives <= 0) gameOver();
  }

  // The run's cash deliberately does not reach the wallet here. It sits on the
  // card until you hit play again, so you get to watch it move.
  function gameOver() {
    playing = false;
    if (score > highScore) highScore = score;
    save();
    ending = true;
    endPhase = PH_IN;
    panelY = END_START;
    panelVy = 0;
    panelW = cardWidth();
  }

  function startGame() {
    playing = true;
    reset();
    add(fx, { x: player.x, y: player.y, life: 2 });
    shake += 3;
    sfx(SFX.start);
  }

  // Pay out over roughly half a second however big the haul, with a floor so a
  // three-coin run is still long enough to read.
  function startCashout() {
    endPhase = PH_CASHOUT;
    cashAcc = 0;
    cashStep = max(0.34, cash / 30);
    if (cash <= 0) launchCard();
  }

  function launchCard() {
    save();
    endPhase = PH_OUT;
    panelVy = END_KICK;
  }

  // One frame of the end card, whichever part of its life it's in.
  function stepEnd() {
    if (endPhase === PH_IN) {
      // Spring, not a tween: the card carries its momentum past the middle and
      // has to come back up for it.
      panelVy += (0 - panelY) * END_K;
      panelVy *= END_DAMP;
      panelY += panelVy;
      if (abs(panelY) < 0.5 && abs(panelVy) < 0.5) { panelY = 0; endPhase = PH_WAIT; }

    } else if (endPhase === PH_WAIT) {
      hoverBtn = mouseIn ? hitButton(mouseX, mouseY) : -1;
      // Button 1 is the shop. It lights up and does nothing, for now.
      if (btnp(4) || (clickWanted && hoverBtn === 0)) startCashout();

    } else if (endPhase === PH_CASHOUT) {
      // Drain the card into the wallet a coin at a time. Both counters stay
      // whole numbers; only the rate is fractional.
      cashAcc += cashStep;
      while (cashAcc >= 1 && cash > 0) {
        cashAcc -= 1;
        cash -= 1;
        bank += 1;
        if (cash % 2 === 0) sfx(SFX.coin);
      }
      if (cash <= 0) launchCard();

    } else {
      panelVy += END_GRAV;
      panelY += panelVy;
      if (panelY > 110) { ending = false; startGame(); }
    }

    if (endPhase !== PH_WAIT || !ending) hoverBtn = -1;
    setCursor(hoverBtn >= 0);
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

  // The canvas is one element, so a hand cursor is the only way to tell you
  // that part of it is a button. Only touched when it actually changes.
  var canvasEl = null, cursorOn = false;
  function setCursor(on) {
    if (on === cursorOn || !canvasEl) return;
    cursorOn = on;
    canvasEl.style.cursor = on ? 'pointer' : '';
  }

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
    if (invuln > 0) invuln -= 1;
    if (hurtFlash > 0) hurtFlash -= 1;

    if (ending) stepEnd();

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
        if (dist2(c, player) < 32) hit();
      });

      // ---- orbs
      each(orbs, function (o) {
        o.x += o.vx;
        o.y += o.vy;
        var bounce = wall(o, 1);
        if (bounce !== null) {
          add(fx, { angle: bounce, life: 120 });     // ripple in the wall
          shake += 0.5;
          if (o.charged) {
            sfx(SFX.burnout);
            del(orbs, o);
          } else {
            sfx(SFX.charge);
            o.charged = true;
          }
        } else if (o.charged && dist2(o, player) < 32) {
          hit();
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
              cash = Math.floor(score / 100);
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

    // The very first game still starts on a keypress; after that the card's
    // own button takes over, and stepEnd() handles it.
    if (!playing && !ending && btnp(4)) startGame();
    btnHit = 0;
    clickWanted = false;
  }

  // ------------------------------------------------------------------- draw
  var RING_STEP = 524 / 65536;     // ~0.008 of a turn: 126 points around the wall

  function draw() {
    P.camera(rnd(shake) - rnd(shake) - 64, rnd(shake) - rnd(shake) - 64);
    P.cls();

    // The big number behind everything. It's hidden once the end card is on
    // its way in, otherwise it pokes out over the top edge mid-slide.
    if (!ending) {
      var s = '' + score;
      P.print('\x06w\x06t' + s, -s.length * 4, -5, 1);
    }

    // The ship, a triangle aimed at the middle. It strobes while the grace
    // period after a hit is running, so you can see the window closing.
    if (playing && !(invuln > 0 && flr(invuln / 4) % 2)) {
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

    drawLives();
    drawWallet();
    if (ending) drawEndCard();
  }

  // Three squares in the bottom-left corner, outside the wall. A square you
  // still have is solid; one you've lost keeps its outline. The one you just
  // lost blinks for half a second on its way out.
  var VELVET = 16, GOLD = 17, GREY = 13, RED = 8;
  function drawLives() {
    for (var i = 0; i < LIVES; i++) {
      var x = -60 + i * 8, y = 54;
      var solid = i < lives;
      if (!solid && i === lives && hurtFlash > 0 && flr(hurtFlash / 4) % 2) solid = true;
      if (solid) P.rectfill(x, y, x + 4, y + 4, VELVET);
      else P.rect(x, y, x + 4, y + 4, VELVET);
    }
  }

  // The wallet, top right, always on screen. Dimmed while you play, gold once
  // the run is over and the card starts feeding it. Spelled out rather than
  // "$3" because at 3x5 the dollar glyph is a dead ringer for a 5.
  function drawWallet() {
    var s = 'cash: ' + bank;
    P.print(s, 61 - s.length * 4, -60, ending ? GOLD : GREY);
  }

  // ---------------------------------------------------------- the end card
  // Three lines of results, two buttons under them, the lot centred on panelY
  // so the buttons ride along with the card through every animation.
  var CARD_H = 34, BTN_H = 11, BTN_GAP = 4, CARD_GAP = 4;
  var BTN_LABELS = ['play again', 'shop'];

  function textW(s) { return s.length * 4 - 1; }
  function endLines() {
    return ['score: ' + score, 'high score: ' + highScore, 'earned: ' + cash];
  }

  // Measured once, when the card is built. Left to recompute every frame it
  // would shrink under the cashout counter and jitter.
  function cardWidth() {
    var lines = endLines(), w = 0;
    for (var i = 0; i < lines.length; i++) w = max(w, textW(lines[i]));
    return w + 12;
  }

  function endLayout() {
    var w = panelW;
    var bw = [textW(BTN_LABELS[0]) + 9, textW(BTN_LABELS[1]) + 9];
    var rowW = bw[0] + BTN_GAP + bw[1];
    var top = flr(panelY) - flr((CARD_H + CARD_GAP + BTN_H) / 2);

    var lay = { x: -flr(w / 2), y: top, w: w, btns: [] };
    var bx = -flr(rowW / 2), by = top + CARD_H + CARD_GAP;
    for (var i = 0; i < 2; i++) {
      lay.btns.push({ label: BTN_LABELS[i], x: bx, y: by, w: bw[i] });
      bx += bw[i] + BTN_GAP;
    }
    return lay;
  }

  function hitButton(gx, gy) {
    var btns = endLayout().btns;
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (gx >= b.x && gx <= b.x + b.w && gy >= b.y && gy <= b.y + BTN_H) return i;
    }
    return -1;
  }

  function drawEndCard() {
    var lay = endLayout(), lines = endLines();
    P.rectfill(lay.x, lay.y, lay.x + lay.w, lay.y + CARD_H, 0);
    P.rect(lay.x, lay.y, lay.x + lay.w, lay.y + CARD_H, 7);
    for (var i = 0; i < lines.length; i++)
      P.print(lines[i], lay.x + 6, lay.y + 7 + i * 8, 7);

    // Grey until the pointer is on one, then the game's own red.
    for (var i = 0; i < lay.btns.length; i++) {
      var b = lay.btns[i], c = i === hoverBtn ? RED : GREY;
      P.rectfill(b.x, b.y, b.x + b.w, b.y + BTN_H, 0);
      P.rect(b.x, b.y, b.x + b.w, b.y + BTN_H, c);
      P.print(b.label, b.x + flr((b.w + 1 - textW(b.label)) / 2), b.y + 3, c);
    }
  }

  // --------------------------------------------------------------- the shell
  function boot() {
    var canvas = document.getElementById('screen');
    var screen = P.Screen(canvas);
    canvasEl = canvas;
    load();
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

    // ---- mouse, for the end card's buttons. Page pixels come back as game
    // coordinates, -64..63, so the hit test works in the numbers the card is
    // drawn with, whatever size the canvas has been stretched to.
    function toGame(ev) {
      var r = canvas.getBoundingClientRect();
      mouseX = (ev.clientX - r.left) / r.width * 128 - 64;
      mouseY = (ev.clientY - r.top) / r.height * 128 - 64;
      mouseIn = true;
    }
    canvas.addEventListener('mousemove', toGame);
    canvas.addEventListener('mouseleave', function () { mouseIn = false; });
    canvas.addEventListener('click', function (ev) {
      toGame(ev);
      clickWanted = true;
      audio.unlock();
    });

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
