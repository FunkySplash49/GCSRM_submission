# dead center

A small arcade game in a 128×128 box. You can't shoot. Your ship does that on its
own, every couple of seconds, always straight at the middle, whether you're ready
or not.

[Play it](#) · runs on phones · no install

## The idea

You drift around inside a circle. Red rings drift too, and touching one kills you.
Your ship fires at dead center on a timer you don't control.

So you aim by moving. Line yourself up so the shot leaves you, crosses the middle,
and lands on a ring.

Miss, and the shot carries on to the far wall, bounces, and comes back red. A red
shot is worth 200 instead of 100. It will also kill you, and it's now heading back
along the line you were standing on when you fired it.

That's the whole game. You spend most of it dodging your own bullets.

## Controls

| key | |
| --- | --- |
| arrows or WASD | move |
| Z | start, restart |
| M | mute |

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

Key presses are latched rather than sampled each frame. Someone mashing Z to restart
can press and release inside a single frame, and the press still counts.
