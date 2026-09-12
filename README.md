# dead center

A small arcade game in a 128×128 box. You can't shoot. Your ship does that on its
own, every couple of seconds, always straight at the middle, whether you're ready
or not.

**[Play it](https://gcsrmsubmission.vercel.app)** · no install · works off the
filesystem

The rules come from a PICO-8 cart called `dead_center`; [what I added](#where-this-came-from)
is at the end.

## The idea

You drift around inside a circle. Red rings drift too, and touching one costs you
a life. Your ship fires at dead center on a timer you don't control.

So you aim by moving. Line yourself up so the shot leaves you, crosses the middle,
and lands on a ring.

Miss, and the shot carries on to the far wall, bounces, and comes back red. A red
shot is worth 200 instead of 100. It will also take a life, and it's now heading
back along the line you were standing on when you fired it.

That's the whole game. You spend most of it dodging your own bullets.

## Lives and cash

Three velvet squares in the bottom left. Take a hit and the rightmost one blinks
for half a second, then empties out to an outline. You get a second and a half of
grace afterwards and the ship strobes while it runs down, because a core you're
sitting on would take all three squares in three frames otherwise.

Anything that gets hit sheds a handful of pixels in its own colour, white off the
ship and red off the rings. They arc away from wherever they were knocked loose,
fall through the wall, and drop off the bottom of the screen.

Every 100 points is one coin. Lose the last square and the ship comes apart into a
dozen of those pixels, then a card drops in from above, overshoots the middle,
bounces back up and settles, showing the run's score, your best, and what you
earned. Click play again and the earnings count down to zero while the wallet in
the top right climbs by the same amount, then the card winds up and slingshots off
the bottom of the screen.

The wallet sits up there the whole time, grey while you're playing and gold once
you're dead. It's saved to the browser along with your high score and whatever
cards you own, so it's still there tomorrow.

## The shop

Next to play again. It offers one to three cards a death, each rolled
independently: a card you don't own always turns up, and every level after that is
rarer than the last. The price follows the odds, so a level 5 upgrade costs roughly
ten times what a new card does. One purchase per death, then the shop greys out
until the next run.

Four cards, five levels each:

| card | what it does |
| --- | --- |
| **burst** | a bar climbs the right-hand wall as you land shots, faster on red ones. Full bar, press Z, and for a few seconds you fire twice as often, three shots at a time, fanned twenty degrees. Then four seconds of lockout. |
| **shard** | a ring you kill throws two red shots into the arena on the way out, somewhere in a 135° cone around the shot that killed it. They're live, and they'll take a life off you. |
| **boom** | a ring may shake in place for four fifths of a second and then detonate. Anything the blast touches dies for 100, and that includes you. |
| **gold** | bigger rings worth 200, or 400 on a red hit, both climbing with level. They start out as one spawn in five and take over from there. |

The bag in the top-left corner of the death screen holds what you've bought.
Click a card for its level and what it does. Either button wears a small
exclamation mark when there's something in it you haven't looked at.


## Controls

| | |
| --- | --- |
| arrows or WASD | move |
| Z | start a run, and fire a burst once the bar is full |
| M | mute |
| F | fullscreen, or the button under the screen |
| mouse | every button: play again, shop, the bag, return, and the cards |

Fullscreen picks the largest whole number of device pixels per game pixel that
fits, so 128 pixels across stays 128 sharp squares instead of a mix of two widths.
On a 900-tall display that works out at 13 device pixels each, and the few left
over become black margin.

The pointer is drawn in the game's own pixels, so it changes with the screen
rather than sitting on top of it.

On a phone, drag anywhere to move and tap to start. The shop and the bag need a
mouse for now.

## Running it

No build step, no dependencies, no package manager. Two ways in:

**Double-click `index.html`.** It runs straight off the filesystem, which is why
everything is a classic `<script src>` rather than an ES module.

**Or serve the folder,** if you'd rather:

```
git clone https://github.com/FunkySplash49/GCSRM_submission.git
cd GCSRM_submission
python3 -m http.server 8000
```

Then open http://localhost:8000.

## How it's put together

Everything is drawn one pixel at a time into a 128×128 byte array of palette
indices, and the whole array goes to the canvas once a frame. No image files, no
audio files, no CSS animation. The wall, the ship, the score and the little `+200`
popups are all plotted with a Bresenham line routine and a midpoint circle routine
written out in `src/p8.js`.

The sprites that do exist are written as text. Each one is an array of strings, a
hex digit per pixel, so a card cover or the backpack icon sits in `src/game.js`
next to the code that draws it:

```js
var SPR_GOLD = [
  '..9999..',
  '.9....9.',
  '9......9',
  ...
];
```

Same story for sound. Every effect is a short string:

```js
kill200: 's3>>x5cgc4c1c0'
```

That reads as speed 3, volume up twice, fade-out envelope, then the notes
C3 G3 C4 C1 C0. A synthesiser in `src/p8.js` renders each string into an audio
buffer the first time it plays and reuses it after that, so firing a shot costs
nothing.

The wall is the part I like most. It's a 126-point polyline at radius 58, and every
impact adds a wavelet that creeps outward around the circumference for two seconds
while fading. Land four shots in quick succession and the whole ring goes wobbly.
Two wavelets overlapping add their displacement, so crests stack and opposite
phases cancel.

The death card, the shop and the bag all fall on the same damped spring, which is
why each one carries its momentum past the middle and has to come back up for it.
Going out they get a small upward kick and then constant downward acceleration,
which reads as the same move in reverse.

### Files

```
index.html      the page
style.css       the cabinet around the screen
src/p8.js       framebuffer, rasterisers, font, sprite blitter, sound synth
src/game.js     the rules, the cards, the shop, the three panels
```

### Two things to know before you change anything

The loop runs on a fixed 60 Hz accumulator instead of raw `requestAnimationFrame`,
so the game plays at the same speed on a 144 Hz monitor as on a 60 Hz one. Whatever
you add to `step()` runs exactly 60 times a second, and you can budget in frames.

`endLayout()` and its siblings are the only place a panel's geometry lives. Drawing
and mouse hit-testing both read it, because the two drifted apart the first time
they didn't.

## Where this came from

`dead_center` was a PICO-8 cart first. Its arena radius, spawn exclusion,
collision threshold, wave timing, fire interval and six sound strings are the
original's, and so is the 3x5 font in `src/p8.js`. The build I worked from carries
no author name anywhere in it, so if you know whose cart it is, the credit belongs
here and I'll add it.

The rest is mine:

- The browser rewrite. A 128x128 framebuffer in plain JavaScript, with the
  rasterisers, palette and sound synth written from documented conventions rather
  than lifted.
- Three lives, a second and a half of grace after a hit, and the squares that
  blink out when you lose one.
- Debris. Anything that dies sheds pixels in its own colour and they fall off the
  screen.
- Cash, a wallet, and a high score that all survive a refresh.
- The death card, the shop and the bag, all three riding the same spring in and
  the same kick-and-drop out.
- Four ability cards at five levels each, and a shop that prices them by how rare
  the upgrade is.
- A pointer drawn in the game's own pixels instead of CSS.
- One more thing, not on this list.
