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

  // The four abilities, and what level of each you own. 0 means you don't.
  var MAX_LV = 5;
  var C_BURST = 0, C_SHARD = 1, C_BOOM = 2, C_GOLD = 3;
  var lv = [0, 0, 0, 0];
  var shopSeen = false;          // the shop badge only nags until you look once
  var invNew = false;            // something arrived in the bag since you last opened it

  // Three panels share one slide: the death card, the shop and the bag. Each
  // drops in on a spring, waits for a click, and launches back out. `next` is
  // what replaces it once it has gone -- PANEL_NONE meaning the run restarts.
  var PANEL_NONE = 0, PANEL_DEAD = 1, PANEL_SHOP = 2, PANEL_INV = 3;
  var PH_IN = 0, PH_WAIT = 1, PH_CASHOUT = 2, PH_SPEND = 3, PH_OUT = 4;
  var END_K = 0.16, END_DAMP = 0.68, END_START = -90;
  var END_KICK = -2.4, END_GRAV = 0.6;   // the wind-up, then the slingshot
  var ending, panel = PANEL_NONE, panelNext, phase, panelY, panelVy, panelW;
  var cashAcc, cashStep, spendLeft;

  var offers = [];      // what the shop is showing, and for how much
  var picked = -1;      // which inventory slot is selected
  var bought = false;   // one card per death, and this is the death you bought on

  // ---- the four abilities, and the numbers behind them
  var BURST_HITS = 4;              // kills to fill the bar at level 1
  var BURST_RUN = 180;             // frames it stays open at level 1
  var BURST_COOL = 240;            // four seconds locked out afterwards
  var BURST_IDLE = 660;            // eleven quiet seconds and the bar starts leaking
  var BURST_SPREAD = 20 / 360;     // twenty degrees, in turns
  var SHARD_CONE = 135 / 360, SHARD_MIN = 12.5 / 360;
  var BOOM_FUSE = 48, BOOM_GROW = 1.2, BOOM_REACH = 2.5;
  var GOLDC = 9;                   // the ring's own orange, for its chips

  // Type the word on the title screen and red projectiles start painting the
  // wall. Session only: it is deliberately not saved, so it goes when you do.
  var CODE = 'easter';
  var RAMP = [8, 9, 10, 11, 12, 13, 14];   // red orange yellow green blue indigo pink
  var typed = '', rainbow = false, codeShown = 0;

  var burstBar, burstOn, burstCool, sinceKill;
  var blasts;                      // white rings opening out of a detonation

  function burstNeed() { return BURST_HITS * Math.pow(1.2, lv[C_BURST] - 1); }
  function burstRun()  { return BURST_RUN * Math.pow(1.4, lv[C_BURST] - 1); }
  function shardChance() { return lv[C_SHARD] ? 0.15 + 0.10 * (lv[C_SHARD] - 1) : 0; }
  function boomChance()  { return lv[C_BOOM]  ? 0.10 + 0.08 * (lv[C_BOOM]  - 1) : 0; }
  function goldChance()  { return lv[C_GOLD]  ? 0.20 + 0.10 * (lv[C_GOLD]  - 1) : 0; }
  function goldPoints(charged) {
    return (charged ? 400 : 200) + (lv[C_GOLD] - 1) * (charged ? 200 : 100);
  }
  function coreHit(c) { return c.gold ? 44 : 32; }   // squared, and gold is bigger

  // Chips knocked off whatever just got hit. They carry the colour of the thing
  // they came from, arc away from its edge, and fall off the bottom of the
  // screen. Kept out of fx because the wall loop walks that list every frame.
  var GRAVITY = 0.12;
  var bits;

  // scale multiplies each chip's side, rounded to whole pixels because that is
  // all there is at this resolution. Rings pass 1.5; the ship leaves it alone.
  function shave(x, y, r, c, n, speed, scale) {
    scale = scale || 1;
    for (var i = 0; i < n; i++) {
      var a = rnd(), v = speed * (0.5 + rnd(0.6));
      add(bits, {
        x: x + cos(a) * r, y: y + sin(a) * r,      // off the surface, not the middle
        vx: cos(a) * v, vy: sin(a) * v - 0.5,      // a little lift, so they arc
        s: max(1, Math.round((rnd() < 0.3 ? 2 : 1) * scale)), c: c
      });
    }
  }

  // Mouse, kept in game coordinates. Only the end card cares.
  var mouseX = 0, mouseY = 0, mouseIn = false, clickWanted = false;
  var hoverBtn = -1;

  // High score, wallet and owned cards outlive the tab. Set this false to make
  // every refresh start from nothing, which is how the shop was tested.
  var PERSIST = true;

  // Wrapped because private browsing throws on the first read rather than
  // returning null.
  function load() {
    if (!PERSIST) { save(); return; }     // stamp the defaults over whatever was there
    try {
      highScore = +localStorage.getItem('dc.hi') || 0;
      bank = +localStorage.getItem('dc.bank') || 0;
      lv = JSON.parse(localStorage.getItem('dc.lv') || '[0,0,0,0]');
      shopSeen = localStorage.getItem('dc.shopseen') === '1';
      invNew = localStorage.getItem('dc.invnew') === '1';
    } catch (e) { /* no storage, or nothing parseable in it */ }
  }
  function save() {
    try {
      localStorage.setItem('dc.hi', highScore);
      localStorage.setItem('dc.bank', bank);
      localStorage.setItem('dc.lv', JSON.stringify(lv));
      localStorage.setItem('dc.shopseen', shopSeen ? '1' : '0');
      localStorage.setItem('dc.invnew', invNew ? '1' : '0');
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
    var drift = rnd(), gold = rnd() < goldChance();
    add(fx, { x: x, y: y, life: 2 });
    shake += 1;
    add(cores, {
      x: x, y: y, vx: cos(drift) * 0.25, vy: sin(drift) * 0.25,
      gold: gold, r: gold ? 4 : 3, fuse: 0
    });
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
    bits = [];
    shake = 0;
    lives = LIVES;
    invuln = 0;
    hurtFlash = 0;
    cash = 0;
    ending = false;
    burstBar = 0;
    burstOn = false;
    burstCool = 0;
    sinceKill = 0;
    blasts = [];
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
    if (lives > 0) shave(player.x, player.y, 4, 7, 3 + flr(rnd(4)), 1.1);
    else {
      shave(player.x, player.y, 4, 7, 6 + flr(rnd(7)), 2.2);   // the ship comes apart
      gameOver();
    }
  }

  // The run's cash deliberately does not reach the wallet here. It sits on the
  // card until you hit play again, so you get to watch it move.
  function gameOver() {
    playing = false;
    if (score > highScore) highScore = score;
    save();
    ending = true;
    bought = false;
    openPanel(PANEL_DEAD);
  }

  function openPanel(p) {
    panel = p;
    phase = PH_IN;
    panelY = END_START;
    panelVy = 0;
    if (p === PANEL_DEAD) panelW = cardWidth();
    if (p === PANEL_SHOP) rollOffers();
    if (p === PANEL_INV) picked = firstOwned();
  }

  // Send the current panel out of the bottom of the screen, and say what takes
  // its place when it has gone.
  function leavePanel(next) {
    panelNext = next;
    phase = PH_OUT;
    panelVy = END_KICK;
  }

  // The badge is the whole point of routing a purchase through here rather
  // than writing to lv directly.
  function addCard(i) {
    lv[i] = min(MAX_LV, lv[i] + 1);
    invNew = true;
    save();
  }

  function firstOwned() {
    for (var i = 0; i < 4; i++) if (lv[i] > 0) return i;
    return -1;
  }

  // A card at level L shows with probability 1/(L+1)^1.45, so a card you don't
  // own is certain and each upgrade past that is rarer than the last. The shelf
  // is never empty and never holds more than three.
  function offerChance(i) { return 1 / Math.pow(lv[i] + 1, 1.45); }

  function rollOffers() {
    var pool = [], hit = [];
    for (var i = 0; i < 4; i++) {
      if (lv[i] >= MAX_LV) continue;
      pool.push(i);
      if (rnd() < offerChance(i)) hit.push(i);
    }
    if (!hit.length && pool.length) hit.push(pool[flr(rnd(pool.length))]);
    while (hit.length > 3) hit.splice(flr(rnd(hit.length)), 1);

    // Price tracks rarity: the base is 5 to 10 coins for a card you don't own,
    // and it climbs by exactly the factor the odds fall by. Capped at 1000.
    offers = [];
    for (var j = 0; j < hit.length; j++) {
      var id = hit[j], base = 5 + flr(rnd(6));
      offers.push({ id: id, cost: min(1000, max(1, Math.round(base / offerChance(id)))) });
    }
  }

  function buy(o) {
    if (bought || bank < o.cost) return;
    bought = true;
    addCard(o.id);
    spendLeft = o.cost;
    cashAcc = 0;
    cashStep = max(0.34, o.cost / 30);
    phase = PH_SPEND;
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
    phase = PH_CASHOUT;
    cashAcc = 0;
    cashStep = max(0.34, cash / 30);
    if (cash <= 0) launchCard();
  }

  function launchCard() {
    save();
    leavePanel(PANEL_NONE);
  }

  // One frame of whichever panel is up, wherever it is in its life.
  function stepEnd() {
    if (phase === PH_IN) {
      // Spring, not a tween: the panel carries its momentum past the middle and
      // has to come back up for it.
      panelVy += (0 - panelY) * END_K;
      panelVy *= END_DAMP;
      panelY += panelVy;
      if (abs(panelY) < 0.5 && abs(panelVy) < 0.5) { panelY = 0; phase = PH_WAIT; }

    } else if (phase === PH_WAIT) {
      hoverBtn = mouseIn ? hitButton(mouseX, mouseY) : -1;
      if (clickWanted && hoverBtn >= 0) activate(layout().btns[hoverBtn]);
      if (btnp(4) && panel === PANEL_DEAD) startCashout();

    } else if (phase === PH_CASHOUT) {
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

    } else if (phase === PH_SPEND) {
      // The same counter running the other way: the price comes out of the
      // wallet before the shop leaves, so you watch what it cost you.
      cashAcc += cashStep;
      while (cashAcc >= 1 && spendLeft > 0) {
        cashAcc -= 1;
        spendLeft -= 1;
        bank -= 1;
        if (spendLeft % 2 === 0) sfx(SFX.coin);
      }
      if (spendLeft <= 0) { save(); leavePanel(PANEL_DEAD); }

    } else {
      panelVy += END_GRAV;
      panelY += panelVy;
      if (panelY > 110) {
        if (panelNext === PANEL_NONE) { ending = false; panel = PANEL_NONE; startGame(); }
        else openPanel(panelNext);
      }
    }

    if (phase !== PH_WAIT || !ending) hoverBtn = -1;
  }

  // What a button does. Buttons carry a kind rather than an index so the three
  // panels can lay themselves out however they like.
  function activate(b) {
    if (b.dim) return;
    if (b.kind === 'again') startCashout();
    else if (b.kind === 'shop') { shopSeen = true; save(); leavePanel(PANEL_SHOP); }
    else if (b.kind === 'bag') { invNew = false; save(); leavePanel(PANEL_INV); }
    else if (b.kind === 'back') leavePanel(PANEL_DEAD);
    else if (b.kind === 'buy') buy(offers[b.i]);
    else if (b.kind === 'slot') picked = b.i;
  }

  // -------------------------------------------------------------- abilities

  // A shot lands on a ring. It always scores; whether the ring dies now or
  // stands there shaking with a fuse lit is the explosion card's business.
  function coreShot(c, o) {
    var charged = !!o.charged;
    var points = c.gold ? goldPoints(charged) : (charged ? 200 : 100);
    sfx(charged ? SFX.kill200 : SFX.kill100);
    score += points;
    cash = flr(score / 100);
    sinceKill = 0;
    add(fx, { x: c.x, y: c.y - 4, points: points, life: 40 });
    charge(charged);
    if (c.fuse > 0) return;                         // already counting down
    if (rnd() < boomChance()) { c.fuse = BOOM_FUSE; return; }
    popCore(c, atan2(o.vx, o.vy));
  }

  // The ring actually leaving. `angle` is the heading of the shot that did it;
  // a chain kill passes null and never throws shrapnel, so nothing has to work
  // out an impact vector for it.
  function popCore(c, angle) {
    del(cores, c);
    add(fx, { x: c.x, y: c.y, life: 2 });
    shave(c.x, c.y, c.r, c.gold ? GOLDC : 8, 3 + flr(rnd(4)), 1.1, 1.5);
    shake += 3;
    if (angle !== null && rnd() < shardChance()) shards(c, angle);
  }

  // Two red projectiles into a 135 degree cone around the killing shot, never
  // within 12.5 degrees of each other.
  function shards(c, base) {
    var a1 = base + (rnd() - 0.5) * SHARD_CONE, a2;
    do { a2 = base + (rnd() - 0.5) * SHARD_CONE; } while (abs(a1 - a2) < SHARD_MIN);
    shard(c, a1);
    shard(c, a2);
  }
  function shard(c, a) {
    add(orbs, { x: c.x, y: c.y, vx: cos(a) * 3, vy: sin(a) * 3, charged: true });
  }

  function blowUp(c) {
    popCore(c, null);
    add(blasts, { x: c.x, y: c.y, r: 0, max: c.r * BOOM_REACH });
    sfx(SFX.burnout);
    shake += 5;
  }

  // Red projectiles fill the bar twice as fast. Nothing charges it while the
  // ability is open or while it is cooling down.
  function charge(charged) {
    if (!lv[C_BURST] || burstOn || burstCool > 0) return;
    burstBar = min(1, burstBar + (charged ? 2 : 1) / burstNeed());
  }

  function stepBurst() {
    sinceKill += 1;
    if (burstCool > 0) burstCool -= 1;
    if (burstOn) {
      burstBar -= 1 / burstRun();
      if (burstBar <= 0) { burstBar = 0; burstOn = false; burstCool = BURST_COOL; }
    } else if (burstCool <= 0 && sinceKill > BURST_IDLE) {
      burstBar = max(0, burstBar - 1 / 600);        // a slow leak, nothing more
    }
  }

  // Each blast opens out to two and a half times its ring's radius, taking
  // whatever it touches with it -- you included.
  function stepBlasts() {
    each(blasts, function (b) {
      b.r += BOOM_GROW;
      if (b.r > b.max) { del(blasts, b); return; }
      var r2 = b.r * b.r;
      each(cores, function (c) {
        if (c.caught) return;
        var dx = c.x - b.x, dy = c.y - b.y;
        if (dx * dx + dy * dy > r2) return;
        c.caught = true;
        score += 100;
        cash = flr(score / 100);
        sinceKill = 0;
        add(fx, { x: c.x, y: c.y - 4, points: 100, life: 40 });
        if (rnd() < boomChance()) c.fuse = BOOM_FUSE;
        else popCore(c, null);
      });
      if (playing && dist2(player, b) < r2) hit();
    });
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
    each(bits, function (b) {
      b.vy += GRAVITY;
      b.x += b.vx;
      b.y += b.vy;
      if (b.y > 72 || b.x < -72 || b.x > 72) del(bits, b);
    });
    if (codeShown > 0) codeShown -= 1;
    stepBurst();
    stepBlasts();
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
        if (c.fuse > 0 && --c.fuse === 0) { blowUp(c); return; }
        if (dist2(c, player) < coreHit(c)) hit();
      });

      // ---- orbs
      each(orbs, function (o) {
        o.x += o.vx;
        o.y += o.vy;
        var bounce = wall(o, 1);
        if (bounce !== null) {
          // rb marks the ripple as a red projectile's, which is the only kind
          // the easter egg paints.
          add(fx, { angle: bounce, life: 120, rb: !!o.charged });
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
            if (dist2(o, c) < coreHit(c)) { del(orbs, o); coreShot(c, o); break; }
          }
        }
      });

      // ---- burst shot: a full bar and a press of Z opens it up
      if (lv[C_BURST] && btnp(4) && !burstOn && burstCool <= 0 && burstBar >= 1) {
        burstOn = true;
        sfx(SFX.start);
      }

      // ---- the ship fires itself, always straight at dead center. Burst shot
      // halves the interval and puts three shots through a twenty degree fan.
      fireTimer -= 1;
      if (fireTimer <= 0) {
        var aim = atan2(-player.x, -player.y);
        var n = burstOn ? 3 : 1;
        for (var k = 0; k < n; k++) {
          var a = aim + (n > 1 ? (k / (n - 1) - 0.5) * BURST_SPREAD : 0);
          add(orbs, { x: player.x, y: player.y, vx: cos(a) * 3, vy: sin(a) * 3 });
        }
        shake += 0.5;
        fireTimer = burstOn ? max(5, flr(fireInterval / 2)) : fireInterval;
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
    // A lit ring shakes where it stands, a pixel either way, without losing
    // its drift.
    for (var i = 0; i < cores.length; i++) {
      var c = cores[i];
      var jx = c.fuse > 0 ? flr(rnd(3)) - 1 : 0, jy = c.fuse > 0 ? flr(rnd(3)) - 1 : 0;
      if (c.gold) P.spr(SPR_GOLD, flr(c.x) - 4 + jx, flr(c.y) - 4 + jy);
      else P.circ(c.x + jx, c.y + jy, 3, 8);
    }
    for (var i = 0; i < blasts.length; i++)
      P.circ(blasts[i].x, blasts[i].y, blasts[i].r, 7);

    // The wall. A closed polyline of 126 points at radius 58, bent by every
    // live effect: each ripple is a wavelet whose centre creeps .002 turns per
    // frame away from its impact angle, with amplitude life/30.
    P.line();
    for (var t = 0; t <= 1; t += RING_STEP) {
      var r = 58, loudest = 0, hue = -1;
      for (var j = 0; j < fx.length; j++) {
        var e = fx[j];
        var d = abs(t - (e.angle !== undefined ? e.angle : e.x));
        d = min(d, 1 - d);
        d = d - 0.002 * (120 - e.life);
        if (abs(d + 0.125) >= 0.14) continue;
        r += cos(d / 0.08) * e.life / 30;           // displacement always sums
        if (!rainbow || !e.rb) continue;
        // Position across the packet: -1 at one edge, 1 at the other.
        var u = (d + 0.125) / 0.14;
        // Colour rides the packet's envelope rather than the ripples inside it.
        // The wavelet crosses zero seven times on its way across, and keying
        // colour off that broke the band into stripes.
        var env = (1 - abs(u)) * (e.life / 120);
        // Two waves crossing: whichever has the louder envelope here colours
        // the segment. Averaging two palette indices lands on an unrelated
        // colour, so the loudest wins instead of blending.
        if (env <= loudest) continue;
        loudest = env;
        var band = flr((u + 1) / 2 * RAMP.length);
        hue = RAMP[band < 0 ? 0 : band >= RAMP.length ? RAMP.length - 1 : band];
      }
      // Below the floor the envelope has nothing left, which is what makes the
      // band taper to white at both ends and as the wave dies.
      P.line(cos(t) * r + 0.5, sin(t) * r, loudest > 0.06 ? hue : 7);
    }

    for (var i = 0; i < fx.length; i++) {
      var e = fx[i];
      if (e.points) P.print('+' + e.points, -8 + e.x, e.y, flr(e.points / 32) + 4);
      else if (e.y !== undefined) P.circfill(e.x, e.y, 5, 7);
    }

    for (var i = 0; i < bits.length; i++) {
      var b = bits[i];
      if (b.s > 1) P.rectfill(b.x, b.y, b.x + b.s - 1, b.y + b.s - 1, b.c);
      else P.pset(b.x, b.y, b.c);
    }

    if (codeShown > 0) drawCode();
    drawLives();
    drawBurstBar();
    drawWallet();
    if (ending) drawPanel();

    // Ours, drawn last so nothing paints over it. The canvas hides the
    // browser's, which is why this has to run whether a panel is up or not.
    if (mouseIn) P.spr(SPR_CURSOR, flr(mouseX), flr(mouseY));
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
  // Written in the thing it turns on. The offset walks with the frame count so
  // the letters shimmer, and the last half second flickers out.
  function drawCode() {
    var msg = 'rainbow wave enabled';
    var x = -flr((msg.length * 4 - 1) / 2);
    if (codeShown < 30 && flr(codeShown / 4) % 2) return;
    for (var i = 0; i < msg.length; i++)
      P.print(msg[i], x + i * 4, 22, RAMP[(i + flr(codeShown / 4)) % RAMP.length]);
  }

  // The bar rides just outside the wall on the right, as long as the arena's
  // radius. Grey while it fills, white when it is ready, red while it is open,
  // dark while it is locked out.
  function drawBurstBar() {
    if (!lv[C_BURST] || ending) return;
    var x = 60, top = -29, bot = 29;
    var cold = burstCool > 0;
    P.rect(x, top, x + 2, bot, cold ? 5 : GREY);
    var h = flr(58 * min(1, burstBar));
    if (h > 0)
      P.rectfill(x + 1, bot - h, x + 1, bot - 1,
                 cold ? 5 : burstOn ? RED : burstBar >= 1 ? 7 : 6);
  }

  function drawWallet() {
    var s = 'cash: ' + bank;
    P.print(s, 61 - s.length * 4, -60, ending ? GOLD : GREY);
  }

  // ---------------------------------------------------------- the end card
  // Three lines of results, two buttons under them, the lot centred on panelY
  // so the buttons ride along with the card through every animation.
  var CARD_H = 34, BTN_H = 11, BTN_GAP = 4, CARD_GAP = 4;
  var BTN_LABELS = ['play again', 'shop'];

  // The bag, traced down from the reference art to 7x7: strap nubs, a grey flap
  // with its bottom edge, a white front and a pocket. At this size the black
  // outline the source leans on costs more pixels than it earns, so the shapes
  // sit straight on the grey tile and the tile does the separating. Seven is the
  // floor -- at six the flap and the pockets collapse into each other.
  var SPR_BAG = [
    '..666..',
    '6666666',
    '0000000',
    '7777777',
    '7000007',
    '7777777',
    '6666666'
  ];

  // The card covers, traced out of the .ppp files in assest/ and recoloured to
  // the palette: the source reds become the game's red and orange so a card
  // reads as the thing it does. Gold Rings uses the ring sprite as its own cover.
  var SPR_CARD = [
    [ '7..........',
      '77.........',
      '777..77..77',
      '77.........',
      '7..........' ],
    [ '....99......',
      '9....9......',
      '..........8.',
      '.........7..',
      '.88..777..7.',
      '.89.7...7.7.',
      '.....77.7...',
      '......7.7...',
      '..7...77....',
      '...77.......',
      '...........9',
      '99........99',
      '.9..........' ],
    [ '99.............',
      '99...888888..99',
      '....8......8..9',
      '...8........8..',
      '..8999.......8.',
      '..8..999.....8.',
      '..8..9.......8.',
      '..8...9......8.',
      '..8.......9..8.',
      '..8......99..8.',
      '...8......998..',
      '....8......8...',
      '.99..888888....',
      '.99...........9' ],
    [ '..9999..',
      '.9....9.',
      '9......9',
      '9......9',
      '9......9',
      '9......9',
      '.9....9.',
      '..9999..' ]
  ];
  var SPR_GOLD = SPR_CARD[C_GOLD];

  var SPR_RETURN = [
    'dddddddddddddddd',
    'd..............d',
    'd..............d',
    'd...77777777...d',
    'd..7........7..d',
    'd..7........7..d',
    'd..7........7..d',
    'd...........7..d',
    'd.....7.....7..d',
    'd....7......7..d',
    'd...77777777...d',
    'd....7.........d',
    'd.....7........d',
    'd..............d',
    'd..............d',
    'dddddddddddddddd'
  ];

  // Drawn into the framebuffer rather than set as a CSS cursor, so it lives in
  // the same 128x128 as everything else. The canvas hides the real one.
  var SPR_CURSOR = [
    '88..........',
    '8888........',
    '.8888.......',
    '.888888.....',
    '..8888888...',
    '...8888888..',
    '...88888888.',
    '....888888..',
    '....88888...',
    '.....888.8..',
    '......8...8.',
    '...........8'
  ];

  // Name, and a description wrapped by hand to the widths the two panels allow.
  var CARD_NAME = ['burst', 'shard', 'boom', 'gold'];
  var CARD_DESC = [
    ['z fires a fast wide burst', 'once the bar is full'],
    ['kills spray two red shots', 'into the arena'],
    ['kills may blow up, taking', 'nearby rings and you'],
    ['bigger rings, double the', 'points, red hits pay more']
  ];

  // Something wants looking at. The black field is the point: it punches the
  // badge out of whatever it lands on, grey border or red one.
  var SPR_BANG = [
    '00000',
    '08880',
    '08880',
    '00800',
    '00800',
    '00000',
    '00800',
    '00000'
  ];

  // The same mark for the bag tile, which is too small to wear the big one.
  var SPR_BANG_S = [
    '000',
    '080',
    '080',
    '000',
    '080',
    '000'
  ];

  // The bag tile sits in the top-left corner and stays there, so it is the one
  // button that does not ride the card.
  var INV_X = -60, INV_Y = -60, INV_W = 8;

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

  // ------------------------------------------------------------ the panels
  // Every panel is measured from `top`, which is the only thing panelY moves,
  // so the whole screen rides the spring as one piece. layout() is the single
  // source of the geometry: drawing and hit-testing both read it.

  function sprW(sp) { return sp[0].length; }
  function sprH(sp) { return sp.length; }

  function deadLayout() {
    var w = panelW;
    var bw = [textW(BTN_LABELS[0]) + 9, textW(BTN_LABELS[1]) + 9];
    var rowW = bw[0] + BTN_GAP + bw[1];
    var top = flr(panelY) - flr((CARD_H + CARD_GAP + BTN_H) / 2);

    var lay = { x: -flr(w / 2), y: top, w: w, btns: [] };
    var bx = -flr(rowW / 2), by = top + CARD_H + CARD_GAP;
    var kinds = ['again', 'shop'];
    for (var i = 0; i < 2; i++) {
      lay.btns.push({
        kind: kinds[i], label: BTN_LABELS[i], x: bx, y: by, w: bw[i], h: BTN_H,
        badge: i === 1 && !shopSeen && !bought, dim: i === 1 && bought
      });
      bx += bw[i] + BTN_GAP;
    }
    lay.btns.push({
      kind: 'bag', x: INV_X, y: INV_Y, w: INV_W, h: INV_W, small: true, badge: invNew
    });
    return lay;
  }

  // Shop: a header, up to three cards across, and the hovered card's blurb
  // along the bottom. The blurb is full width because three columns of this
  // font is ten characters each, which is a name and not a description.
  var SHOP_X = -60, SHOP_W = 119, SHOP_H = 90;
  var SLOT_W = 35, SLOT_H = 45;

  function shopLayout() {
    var top = flr(panelY) - flr(SHOP_H / 2);
    var lay = { x: SHOP_X, y: top, w: SHOP_W, h: SHOP_H, btns: [] };
    lay.btns.push({ kind: 'back', x: SHOP_X + SHOP_W - 17, y: top + 2, w: 15, h: 15 });
    for (var i = 0; i < offers.length; i++)
      lay.btns.push({
        kind: 'buy', i: i, x: SHOP_X + 3 + i * (SLOT_W + 3), y: top + 20,
        w: SLOT_W, h: SLOT_H, dim: bank < offers[i].cost
      });
    return lay;
  }

  // Inventory: owned cards on the left, the selected one's sprite and level on
  // the right, its words along the bottom for the same reason as the shop.
  var INVP_X = -60, INVP_W = 119, INVP_H = 88;

  function invLayout() {
    var top = flr(panelY) - flr(INVP_H / 2);
    var lay = { x: INVP_X, y: top, w: INVP_W, h: INVP_H, btns: [] };
    lay.btns.push({ kind: 'back', x: INVP_X + INVP_W - 17, y: top + 2, w: 15, h: 15 });
    var n = 0;
    for (var i = 0; i < 4; i++) {
      if (!lv[i]) continue;
      lay.btns.push({
        kind: 'slot', i: i, x: INVP_X + 4 + n * 18, y: top + 26, w: 16, h: 16
      });
      n += 1;
    }
    return lay;
  }

  function layout() {
    if (panel === PANEL_DEAD) return deadLayout();
    if (panel === PANEL_SHOP) return shopLayout();
    if (panel === PANEL_INV) return invLayout();
    return { btns: [] };
  }

  function hitButton(gx, gy) {
    var btns = layout().btns;
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (gx >= b.x && gx <= b.x + b.w && gy >= b.y && gy <= b.y + b.h) return i;
    }
    return -1;
  }

  // ------------------------------------------------------------- panel paint

  function frame(lay) {
    P.rectfill(lay.x, lay.y, lay.x + lay.w, lay.y + lay.h, 0);
    P.rect(lay.x, lay.y, lay.x + lay.w, lay.y + lay.h, 7);
  }

  function sprAt(sp, cx, cy) {
    P.spr(sp, cx - flr(sprW(sp) / 2), cy - flr(sprH(sp) / 2));
  }

  function drawPanel() {
    if (panel === PANEL_DEAD) drawDead();
    else if (panel === PANEL_SHOP) drawShop();
    else if (panel === PANEL_INV) drawInv();
  }

  function drawDead() {
    var lay = deadLayout(), lines = endLines();
    P.rectfill(lay.x, lay.y, lay.x + lay.w, lay.y + CARD_H, 0);
    P.rect(lay.x, lay.y, lay.x + lay.w, lay.y + CARD_H, 7);
    for (var i = 0; i < lines.length; i++)
      P.print(lines[i], lay.x + 6, lay.y + 7 + i * 8, 7);
    drawButtons(lay);
  }

  function drawShop() {
    var lay = shopLayout(), top = lay.y;
    frame(lay);
    P.print('shop', lay.x + 4, top + 5, 7);

    for (var i = 0; i < offers.length; i++) {
      var o = offers[i], b = lay.btns[i + 1];
      var c = bank < o.cost ? 5 : (hoverBtn === i + 1 ? RED : GREY);
      P.rect(b.x, b.y, b.x + b.w, b.y + b.h, c);
      sprAt(SPR_CARD[o.id], b.x + flr(b.w / 2), b.y + 11);
      var nm = CARD_NAME[o.id];
      P.print(nm, b.x + flr((b.w + 1 - textW(nm)) / 2), b.y + 24, 7);
      var l = 'lv ' + (lv[o.id] + 1);
      P.print(l, b.x + flr((b.w + 1 - textW(l)) / 2), b.y + 32, GREY);
      var pr = '' + o.cost;
      P.print(pr, b.x + flr((b.w + 1 - textW(pr)) / 2), b.y + 39, bank < o.cost ? 5 : GOLD);
    }

    // Whatever the pointer is on gets explained; otherwise say what the rules are.
    var hv = hoverBtn > 0 && hoverBtn <= offers.length ? offers[hoverBtn - 1].id : -1;
    var say = hv >= 0 ? CARD_DESC[hv]
            : offers.length ? ['one card per death.', 'hover a card to read it']
                            : ['nothing left to sell.', 'come back next run'];
    for (var j = 0; j < say.length; j++)
      P.print(say[j], lay.x + 4, top + 70 + j * 8, hv >= 0 ? 7 : GREY);

    drawButtons(lay);
  }

  function drawInv() {
    var lay = invLayout(), top = lay.y;
    frame(lay);
    P.print('inventory', lay.x + 4, top + 5, 7);

    var have = 0;
    for (var i = 0; i < 4; i++) if (lv[i]) have += 1;
    var cnt = have + '/4';
    P.print(cnt, lay.x + lay.w - 21 - textW(cnt), top + 5, GREY);

    P.rect(lay.x + 3, top + 19, lay.x + 79, top + 63, GREY);
    P.rect(lay.x + 83, top + 19, lay.x + lay.w - 3, top + 63, GREY);

    if (picked < 0) {
      P.print('empty', lay.x + 8, top + 30, 5);
    } else {
      sprAt(SPR_CARD[picked], lay.x + 100, top + 30);
      var l = 'lv ' + lv[picked] + '/' + MAX_LV;
      P.print(l, lay.x + 100 - flr(textW(l) / 2), top + 48, 7);
      var d = CARD_DESC[picked];
      for (var j = 0; j < d.length; j++)
        P.print(d[j], lay.x + 4, top + 68 + j * 8, 7);
    }

    drawButtons(lay);
  }

  // Grey until the pointer is on one, then the game's own red.
  function drawButtons(lay) {
    for (var i = 0; i < lay.btns.length; i++) {
      var b = lay.btns[i], c = b.dim ? 5 : (i === hoverBtn ? RED : GREY);
      if (b.kind === 'back') {
        P.spr(SPR_RETURN, b.x, b.y, GREY, i === hoverBtn ? RED : GREY);
      } else if (b.kind === 'slot') {
        P.rect(b.x, b.y, b.x + b.w, b.y + b.h, b.i === picked ? 7 : c);
        sprAt(SPR_CARD[b.i], b.x + 8, b.y + 8);
      } else if (b.kind === 'buy') {
        /* drawn with its card, above */
      } else if (b.label) {
        P.rectfill(b.x, b.y, b.x + b.w, b.y + b.h, 0);
        P.rect(b.x, b.y, b.x + b.w, b.y + b.h, c);
        P.print(b.label, b.x + flr((b.w + 1 - textW(b.label)) / 2), b.y + 3, c);
      } else {
        P.rectfill(b.x, b.y, b.x + b.w, b.y + b.h, 5);
        P.rect(b.x, b.y, b.x + b.w, b.y + b.h, c);
        P.spr(SPR_BAG, b.x + 1, b.y + 1);
      }
      // Overhangs the top-right corner far enough to read as pinned on, not so
      // far that it bites the card above or falls off the top of the screen.
      if (b.badge) {
        if (b.small) P.spr(SPR_BANG_S, b.x + b.w + 1, b.y - 4);
        else P.spr(SPR_BANG, b.x + b.w - 3, b.y - 3);
      }
    }
  }

  // --------------------------------------------------------------- the shell
  function boot() {
    var canvas = document.getElementById('screen');
    var screen = P.Screen(canvas);
    load();
    reset();
    playing = false;

    // ---- keyboard
    global.addEventListener('keydown', function (ev) {
      // Letters go into the code buffer first: most of them are not bound to
      // anything, so the handler below would have returned before seeing them.
      if (!playing && !ending && ev.key && ev.key.length === 1) {
        typed = (typed + ev.key.toLowerCase()).slice(-CODE.length);
        if (typed === CODE && !rainbow) {
          rainbow = true;
          codeShown = 180;
          sfx(SFX.kill200);
        }
      }
      if (ev.code === 'KeyM') { setMuted(audio.toggleMute()); return; }
      if (ev.code === 'KeyF') { toggleFullscreen(); return; }
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

    // ---- fullscreen. A 128px canvas is nothing until CSS scales it, so going
    // fullscreen means choosing the size by hand: the largest whole number of
    // device pixels per game pixel that still fits. A fractional scale leaves
    // `image-rendering: pixelated` drawing some rows a pixel taller than others,
    // which is very visible on a grid this coarse.
    var bezel = canvas.parentNode || canvas;
    var fullBtn = document.getElementById('full');

    function fsNow() {
      return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    function fitFullscreen() {
      if (fsNow() !== bezel) { canvas.style.width = ''; canvas.style.height = ''; return; }
      var dpr = global.devicePixelRatio || 1;
      var room = Math.min(global.innerWidth, global.innerHeight) * dpr;
      var scale = Math.max(1, flr(room / 128)) / dpr;
      canvas.style.width = canvas.style.height = (128 * scale) + 'px';
    }

    function toggleFullscreen() {
      if (fsNow()) {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) exit.call(document);
        return;
      }
      var req = bezel.requestFullscreen || bezel.webkitRequestFullscreen;
      // Rejects if the browser doesn't count this as a gesture. Nothing to do
      // about that, but an unhandled rejection in the console is noise.
      if (req) { var p = req.call(bezel); if (p && p.catch) p.catch(function () {}); }
    }

    function onFsChange() {
      fitFullscreen();
      if (!fullBtn) return;
      var on = fsNow() === bezel;
      fullBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      fullBtn.textContent = on ? 'exit fullscreen' : 'fullscreen';
    }

    // Guarded: a stale cached index.html without the button would otherwise
    // throw here and take the whole game down with it, blank screen and all.
    if (fullBtn) {
      if (!(bezel.requestFullscreen || bezel.webkitRequestFullscreen)) fullBtn.hidden = true;
      fullBtn.addEventListener('click', toggleFullscreen);
      document.addEventListener('fullscreenchange', onFsChange);
      document.addEventListener('webkitfullscreenchange', onFsChange);
      global.addEventListener('resize', fitFullscreen);
    }

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
