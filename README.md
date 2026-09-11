# dead center

A small arcade game in a 128×128 box. You can't shoot. Your ship does that on its
own, every couple of seconds, always straight at the middle, whether you're ready
or not.

[Play it](https://funkysplash49.github.io/GCSRM_submission/) · runs on phones · no install

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

Every 100 points is one coin. Lose the last square and a card drops in from above,
overshoots the middle, bounces back up and settles, showing the run's score, your
best, and what you earned. Click play again and the earnings count down to zero
while the wallet in the top right climbs by the same amount, then the card winds
up and slingshots off the bottom of the screen.

The wallet sits up there the whole time, grey while you're playing and gold once
you're dead. It's saved to the browser along with the high score, so it's still
there tomorrow. There's a shop button next to play again. It lights up and does
nothing yet.

## Controls

| key | |
| --- | --- |
| arrows or WASD | move |
| Z | start |
| M | mute |

Play again and shop are buttons on the end card, so those need a mouse. Z does the
same thing as play again, and so does a tap on a phone.

On a phone: drag anywhere to move, tap to start.

## Running it

Double-click `index.html`. There's no npm, no bundler and no server involved.

If you want a server anyway:

```
python3 -m http.server 8000
```

## How it's put together

Everything is drawn one pixel at a time into a 128×128 byte array of palette
indices, and the whole array goes to the canvas once a frame. No sprites, no images, no
CSS animation. The wall, the ship, the score and the little `+200` popups are all
plotted with a Bresenham line routine and a midpoint circle routine written out in
`src/p8.js`.

Same story for sound. There are no audio files. Every effect is a short string:

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

The end card falls on a damped spring, which is why it carries its momentum past
the middle and has to come back up for it. Going out it gets a small upward kick
and then constant downward acceleration, which reads as the same move in reverse.

### Files

```
index.html      the page
style.css       the cabinet around the screen
src/p8.js       framebuffer, rasterisers, font, sound synth
src/game.js     the rules
```

### Two things to know before you change anything

The loop runs on a fixed 60 Hz accumulator instead of raw `requestAnimationFrame`,
so the game plays at the same speed on a 144 Hz monitor as on a 60 Hz one. Whatever
you add to `step()` runs exactly 60 times a second, and you can budget in frames.

Key presses are latched rather than sampled each frame. Someone mashing Z can press
and release inside a single frame, and the press still counts.
