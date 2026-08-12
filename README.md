# APL Beats

**Make beats first. Discover array programming second.**

A generative rhythm machine in the browser. Eight tracks, sixteen steps, a groove already
loaded — press Play, then press Randomise.

Live site: <https://dragnim.github.io/aplbeats/>

Underneath the grid is an 8 × 16 matrix of Booleans, which is not an implementation detail
but the whole idea. A rhythm is a rectangular array, array languages are good at rectangular
arrays — and pressing **Apply with APL** sends that matrix to real
[Dyalog APL](https://www.dyalog.com/) and plays back the matrix that comes home.

> **What runs where, precisely.** Generation, timing and sound are local TypeScript and Web
> Audio. The four transformations are executed by Dyalog APL, remotely, via
> [TryAPL](https://tryapl.org/). There is no local fallback for them: if APL is unavailable
> the transform does not happen and the beat is left alone, because an interface that says
> "Apply with APL" and quietly computed the answer itself would be lying. See
> [Transform with APL](#transform-with-apl).

![The APL Beats sequencer and generator, playing](docs/screenshot-playing.png)

---

## Contents

- [What it does](#what-it-does)
- [Transform with APL](#transform-with-apl)
- [The generator](#the-generator)
- [The four macros](#the-four-macros)
- [Presets](#presets)
- [Locks](#locks)
- [Undo](#undo)
- [What is not here yet](#what-is-not-here-yet)
- [Local setup](#local-setup)
- [Development commands](#development-commands)
- [How it is put together](#how-it-is-put-together)
- [Audio timing](#audio-timing)
- [Sounds and licensing](#sounds-and-licensing)
- [Review tooling](#review-tooling)
- [Accessibility](#accessibility)
- [Privacy and what leaves the browser](#privacy-and-what-leaves-the-browser)
- [Respecting the device](#respecting-the-device)
- [Testing](#testing)
- [Deployment](#deployment)
- [Where APL goes next](#where-apl-goes-next)
- [Licence](#licence)

---

## What it does

- **Eight tracks, sixteen steps.** Kick, Snare, Closed Hat, Open Hat, Clap, Low Perc, High
  Perc and Rim, across one bar of four-four in sixteenth notes.
- **Four transformations, executed in APL.** Rotate, Reverse, Periodic and Euclidean, on one
  track or on the whole matrix — with the expression that ran on show if you want to see it.
- **Randomise.** A new take on the groove you have, as far away as Variation allows.
- **New Seed.** A completely new groove, ignoring Variation.
- **Four macros** — Density, Complexity, Syncopation, Variation — each with a distinct
  musical meaning.
- **Eight presets**, which change how the generator behaves rather than loading a fixed
  pattern.
- **A lock per track.** The generator may not touch a locked row; you still can.
- **Undo**, thirty deep, over every creative action.
- **A groove on arrival.** Audio does not autoplay, so the first press of Play is the first
  sound.
- **Play and Pause**, live tempo and swing, mute and a fader per track.
- **Editing by click, tap, drag or keyboard**, unchanged from Stage 1.
- **Your session comes back** when you do — pattern, seed, preset, macros, locks, tempo,
  swing and mixer. It never starts playing on its own.
- **Undo covers transforms too**, so an operation you did not like costs one button.

On a phone the whole bar stays on screen: each track's name, fader, lock and mute move
above its steps rather than beside them.

<img src="docs/screenshot-mobile.png" alt="APL Beats on a phone, with all sixteen steps of every track visible" width="330" />

## Transform with APL

This is the stage where APL stops being a plan.

Choose a track — or all of them — choose an operation, set its number, and press **Apply with
APL**. The pattern is written down as an APL matrix literal, sent to
[TryAPL](https://tryapl.org/) as one expression, evaluated by Dyalog APL, and the eight lines
of ones and zeros that come back become your bar. Nothing about that sentence is a metaphor.

```
your 8 × 16 matrix
  → an APL literal:  8 16⍴1 0 0 0 0 0 1 0 …
  → one expression:  ⎕IO←0 ⋄ m←8 16⍴… ⋄ m[0;]←¯1⌽m[0;] ⋄ m
  → POST to tryapl.org, evaluated by Dyalog APL
  → eight lines of sixteen digits
  → validated, then played
```

### The four operations

`⎕IO←0` is sent with every request, so the APL indices and the grid indices are the same
number. There is no off-by-one anywhere between the sequencer and the interpreter.

| Operation     | The APL       | What it does musically                                                                     |
| ------------- | ------------- | ------------------------------------------------------------------------------------------ |
| **Rotate**    | `¯1⌽m[0;]`    | Moves a rhythm through time. Negative is later. On the whole matrix, every track together. |
| **Reverse**   | `⌽m`          | The last sixteenth becomes the first. `⌽` with nothing on its left.                        |
| **Periodic**  | `0=4\|⍳16`    | A steady pulse every few steps. Four gives you the beats; three gives a cross-rhythm.      |
| **Euclidean** | `5>16\|5×⍳16` | Spreads k hits as evenly across sixteen steps as the arithmetic allows.                    |

Rotate and Reverse **transform** a row, so they can be applied to all eight at once. Periodic
and Euclidean **replace** a row, so they cannot: eight identical rows is not a rhythm, it is a
mistake with eight voices. The Target menu offers what the operation accepts and nothing else.

**Euclidean is `k>16|k×⍳16`, and that was checked rather than trusted.** It is one line where
Bjorklund's algorithm is a recursion, which is exactly the sort of claim that deserves
suspicion. Stage 2 already contains a verified Bjorklund implementation, so the two were
compared exhaustively — in TypeScript, at no cost to TryAPL, by
[`scripts/check-euclidean.ts`](scripts/check-euclidean.ts). Eleven of the seventeen pulse
counts are identical to Bjorklund and the other six are the same rhythm at a fixed rotation,
with the gap structure — never more than two distinct gap lengths, differing by one — holding
throughout. The offset is constant per pulse count, so the Shift control behaves identically in
either formulation.

### There was a fifth, and it was removed

`(s×⍳8)⌽m` gives `⌽` a **vector** left argument, so all eight rows rotate by their own amount
in one glyph, with no loop and no index. It was built as "Stagger" and taken out again after
the musical review, because it was the best APL in the project and the worst music:

1. under `⎕IO←0` the first row's rotation is `s×0`, so the kick never moved at all — which is
   not what "shift each track a little further than the one above" promises;
2. the backbeat was lost at seven of its eight settings;
3. `¯1` and `3` smeared by the same degree, so the control reshuffled rather than intensified,
   and every press had the same character.

The evidence is still reproducible — `npm run review:transforms -- --stagger` computes it —
because a claim that something was rejected is worth nothing without the grid that rejected it.
Make beats first.

### Peek at the APL

Underneath the button is a disclosure showing three things: the **core expression**, with two
lines explaining its glyphs; **your pattern as an array**, one row or all eight; and the **full
request**, the four statements exactly as they are joined with `⋄` and sent.

What it shows is what runs. Not a simplified version, not a pretty-printed one — the same
string the client posts. That is the entire value of the feature, so the tests assert it: the
expression read out of Peek must equal the expression that went over the wire.

Opening Peek makes **no request**. The APL is built from a template in the browser, so it is
free to look at, and it updates as you change the controls.

<img src="docs/screenshot-peek.png" alt="APL Beats with Peek open, showing the core expression, the pattern as an 8 by 16 array, and the full request" width="820" />

The glyphs are set in APL387, bundled at 23 KB. It is public domain under The Unlicence, so it
can be shipped rather than fetched from someone else's CDN — see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Why the timing is not in APL

Because a network is not a clock. Sample-accurate scheduling needs decisions in the low
milliseconds and a round trip to TryAPL takes tens to hundreds of them on a good day, with no
guarantee on a bad one. A drum machine whose tempo depended on somebody else's HTTP latency
would not be a drum machine.

So the division is: **APL decides what the pattern is; Web Audio decides when it is heard.**
That is not a compromise imposed by the wire — it is the same division a hardware sequencer
makes between its pattern memory and its clock.

### The request discipline

TryAPL is a free service run by other people, and this application is a guest on it. So the
rules are enforced in code rather than promised in prose, in one file
([`src/apl/useTransform.ts`](src/apl/useTransform.ts)) small enough to read in a sitting:

- **One deliberate press, at most one request.** `apply` is the only function that can cause
  one, and it is called from one button.
- **Never** per beat, per step, per cell, per animation frame, from the scheduler, from
  playback, on hover, while a control is moving, or continuously while editing.
- **The parameters are spinners, not sliders.** A slider invites dragging and dragging invites a
  request per value. That is not a styling choice, it is the interaction shape the promise
  requires — and a test drags the numbers through their whole range and asserts zero requests.
- **A second press while one is in flight is dropped**, not queued. A held-down key cannot
  become a request storm.
- **Nothing retries.** Not the client, not the service layer, not the hook. A failure is a
  failure, reported once.
- **Identical questions are answered from memory.** Thirty-two answers, keyed on the operation,
  the target, the parameters and the whole pattern — so Apply, Undo, Apply costs one request
  rather than two, and the interface says "Applied, from cache." when it did.
- **`npm test`, `npm run test:e2e`, CI and the Pages deployment make zero live requests.** The
  end-to-end suite mocks the endpoint and drives the real product flow through it.

Live APL is verified deliberately, by hand, by two commands and no others:

```bash
npm run verify:apl-live               # four requests, one per operation
npm run verify:apl-live -- --dry-run  # prints the expressions, sends nothing
npm run verify:deployment             # one request, from the published origin
npm run verify:deployment -- --no-apl # everything except that request
```

`verify:apl-live` builds each expression with the production source builder, sends it with the
production client, reads it with the production parser, and compares the result against the
TypeScript reference — then prints the request count on its own line, whether or not anybody
asked. It refuses to run under CI unless forced.

`verify:deployment` makes the one check nothing else can. Whether a browser will _allow_ the
request from `https://dragnim.github.io` depends on TryAPL's CORS headers and on the
Content-Security-Policy as actually served, and neither can be established from a mock or from
localhost. So it loads the published site, opens Peek, reads the expression, presses Apply
once, and asserts the grid became the reversal of what was sent. Neither command is ever run by
CI.

### What comes back is not trusted

An APL error arrives as **HTTP 200**. `LENGTH ERROR` and a caret look exactly like a successful
reply as far as the status code is concerned, so the status code is not what decides. Every
reply passes through:

1. a bounded read — counted in **bytes off the stream**, not characters after decoding, because
   APL glyphs are two or three bytes each and a reply well past the limit can measure
   comfortably inside it if you count `String.length`;
2. JSON parsing, with a stated failure rather than a thrown exception;
3. shape validation of the wire array, assuming nothing;
4. a scan for eleven named APL errors;
5. strict matrix parsing — **exactly** eight lines of **exactly** sixteen tokens, each token
   exactly `"0"` or `"1"`.

Anything that fails leaves the pattern untouched and puts one sentence on screen. Every one of
those sentences ends by saying the beat was not changed, because that is the only thing you
actually need to know; the raw detail goes to the console for whoever wants it.

A reply is also dropped if it **no longer applies**. Between asking and answering you may have
edited a cell, pressed Randomise, or undone something, and a matrix computed from a bar that no
longer exists must not overwrite the bar that does. Compared by value rather than by a revision
counter, so a bar that was edited and then undone still accepts its answer.

### There is no APL editor

You cannot type APL into APL Beats, and this stage deliberately does not let you. The numbers
from the controls are clamped to ranges declared in
[`src/apl/operations.ts`](src/apl/operations.ts) and only then formatted into a template. No
string from the interface is ever spliced into executable source — which is what makes "no
arbitrary APL" a property of the code rather than a claim about the UI. A test builds every
operation at every target with every parameter driven to `±1e9` and `NaN`, and asserts the
result never contains a quote, a comment, `⍎`, `⍕`, `#`, or a system command.

An editor is a later stage's problem, and a much larger one.

### A transform is one Undo

A successful transform banks exactly one history entry, so an operation you did not like costs
one button. A transform that changed nothing — reversing an already-symmetrical row, rotating
by a full bar — banks none, because an Undo that appears to do nothing is worse than no Undo.

Locks are deliberately **not** consulted. A lock means "the generator may not alter this row",
and a transform is not the generator: it is you, naming a row and asking for it to change. The
one case worth knowing about is an operation on the whole matrix, which touches every row
including a locked one — that is what "All tracks" means, and it is the visitor's choice.

## The generator

Every groove is a pure function of its inputs:

```
generator version + seed + preset + Density + Complexity + Syncopation
    → a candidate bar
    then Variation decides how much of that candidate is adopted
```

The same inputs give the same 128 Booleans on every machine, for ever. There is no
`Math.random` anywhere in the generation path — the one non-deterministic call in the whole
application is the drawing of a fresh seed when you press Randomise, and everything
downstream of it is reproducible from the number shown on screen.

**Randomise draws a new seed and blends.** Using the current seed would produce the
identical candidate and the button would appear broken from the second press onwards. The
seed shown is therefore the seed of the most recent candidate.

**New Seed regenerates outright.** Variation does not apply. At a low Variation the two
buttons behave very differently, which is what makes both worth having.

**Changing a preset or a macro re-renders the same seed** at the new setting, so the groove
you are shaping stays the groove you are shaping. Variation is the exception: it says what
the _next_ Randomise will do, so moving it does not touch the current bar.

Generation is not a probability per cell. It works from a metrical model — where events
want to be in a bar of four-four — and then from what each instrument wants, and then from
how the eight parts relate to each other. An open hat is placed where the closed hat is
not, and the closed hat gives way where it lands; a clap doubles or shadows the snare; the
high percussion answers the low; the auxiliary tracks play short figures that come round
again rather than scattering single hits. Those relationships are generated, not hoped for.

### The opening bar is hand-written

The pattern APL Beats opens on is the curated groove from Stage 1, not a generated one. A
search over thirty thousand seeds and every preset found nothing better: the closest match
reproduced the curated hat and open-hat rows exactly and its kick almost exactly, but with
a third fewer triggers and thin percussion, and the only bars that reproduced the curated
kick row came from Glitch, differing by nineteen per cent of their cells and measurably
messier.

So the seed, preset and macro values you arrive on are the **starting point for
generating**, not a recipe that produces the bar in front of you. That distinction is
unavoidable in any case — edit three cells by hand and your pattern is no longer what your
seed produces either — and the canonical truth is simply the current matrix plus the
current settings.

## The four macros

All four run 0–100. They are deliberately four different mechanisms, not four names for one
probability.

| Macro           | Question                     | How it works                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Density**     | How much is happening?       | Sets how many events each track gets, within that track's own range. A hat can carry fourteen; a kick rarely wants more than six. Density therefore does not affect every track equally, which is what a kit actually does.                                                                                                                                                        |
| **Complexity**  | How intricate is the rhythm? | Two things, neither of them a count. It opens up the sixteenth grid — at the bottom of the range the odd steps are shut almost completely, so a pattern _cannot_ be intricate however dense it gets. And it lengthens how far the bar goes before repeating itself: a four-step figure four times over is simple, however many notes are in it.                                    |
| **Syncopation** | How far off the beat?        | Blends the metrical weights towards a second profile that favours the offbeat eighths and the sixteenth _before_ each beat — the anticipation, which is what most syncopation actually is. Not an inversion: inverting metrical weight puts events on the weakest positions, which sounds arbitrary rather than syncopated. At high settings it also lets anchored steps displace. |
| **Variation**   | How far does Randomise move? | Chooses how many of the differing cells to take from the candidate, and — more importantly — _which tracks_ take anything at all. At low settings most tracks are left completely alone, so a bar where the hats developed and nothing else did sounds like a decision rather than a fault.                                                                                        |

Measured over forty seeds, Density takes a bar from about eight triggers to about
thirty-five while Complexity holds the count flat within three; Complexity roughly triples
the events on the sixteenth grid and halves how much the bar repeats itself. Those are
properties the tests assert, as directions rather than thresholds.

Macros commit when the gesture ends — the number moves live, the groove moves once. That
discipline matters more than it looks: it is the interaction shape APL will eventually need,
where regenerating on every input event would be a remote call per pixel.

## Presets

A preset is a set of dispositions, not a saved pattern: how many events each instrument
tends towards, where it likes to sit, which positions it insists on, how readily it repeats
itself, and how the eight parts relate. Two seeds under one preset should sound like two
takes by the same drummer; one seed under two presets like two different drummers.

| Preset            | What it is                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Straight**      | Backbeat, steady hats, few surprises. The kick is pushed off beats two and four so it does not become Four on Floor.                                                                                                |
| **Four on Floor** | A kick on every beat — the one preset whose name is a testable promise — with hats lifting off it.                                                                                                                  |
| **Broken**        | Beats two and four are weighted almost to nothing on the kick, so it lands on the "and" and the pickups. The snare is allowed to arrive early.                                                                      |
| **Syncopated**    | Anticipations everywhere. The widest travel for the Syncopation control.                                                                                                                                            |
| **Sparse**        | Narrower ranges at both ends, reluctant percussion, hats that repeat over a long period — structured space rather than accidental space.                                                                            |
| **Euclidean**     | Bjorklund's even distribution, each track rotated differently so that eight parts do not all begin together. Syncopation moves the rotation, which is the only thing it sensibly can do to an evenly spread rhythm. |
| **Cross**         | Three- and five-step figures against a four-four pulse.                                                                                                                                                             |
| **Glitch**        | Short bursts with deliberate holes, and a snare that will not stay put. The kick stays disciplined, because a kick of random bursts removes the last thing holding the bar together.                                |

**Cross is not called Polyrhythm**, deliberately. The bar is still sixteen steps and still
repeats, so these are cross-rhythms _within_ a bar rather than independent cycles of
different lengths. Calling it Polyrhythm would claim an architecture this stage does not
have, and expanding the transport to get one was explicitly out of scope.

## Locks

A lock means **the generator may not alter this row**. It does not mean you may not: a
locked track stays fully editable by hand, which is the point — you keep a kick you like and
explore a completely different preset around it.

Locks are respected by Randomise, New Seed, preset changes and macro regeneration alike.
There is no code path in which a locked row is generated and then restored, so there is
nothing to get wrong. Lock state is itself part of Undo.

## Undo

Thirty steps, over the creative state: pattern, seed, preset, all four macros, and locks.

Tempo, swing and the mixer are deliberately **outside** it. They are how you listen to what
you made rather than part of it, and putting them in the history would mean that an Undo
after nudging a fader threw away the groove you had been building.

One action is one entry. A drag across eight cells is one Undo; a slider dragged through
fifty values is one Undo, banked when the gesture began and committed when it ended; an APL
transform is one Undo. There is no Redo yet.

## What is not here yet

Named because a README that lists ambitions alongside features cannot be trusted about
either. None of the following exists:

- **An APL editor.** You cannot type your own expressions. The four operations are built
  from templates with clamped numbers, and nothing from the interface reaches executable
  source as text.
- **APL generation.** The generator is still local TypeScript; only the transformations run
  in APL.
- **Offline transforms.** There is no local fallback, on purpose. No APL, no transform.
- Sharing, WAV export, MIDI, accounts.
- More than one bar; variable track lengths; song arrangement.
- Per-step velocity or probability. A step fires or it does not.
- Effects, sample uploads, a light theme.
- Redo.

## Local setup

Requires **Node 22**, not merely Node 22 or later. `.nvmrc` says so and `engines` refuses
anything newer, so that a build here and a build in CI produce the same bundle.

```bash
git clone https://github.com/dragnim/aplbeats.git
cd aplbeats
nvm use        # reads .nvmrc; CI reads the same file
npm install
npm run dev
```

## Development commands

| Command                     | What it does                                                                     |
| --------------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`               | Vite dev server                                                                  |
| `npm run build`             | Typecheck, then build to `dist/`                                                 |
| `npm run preview`           | Serve `dist/` at the published base path                                         |
| `npm run typecheck`         | `tsc --noEmit`                                                                   |
| `npm run lint`              | ESLint, type-aware                                                               |
| `npm run format:check`      | Prettier, checking — this is what CI runs                                        |
| `npm test`                  | Unit and component tests, once                                                   |
| `npm run test:e2e`          | Playwright, across three browser projects                                        |
| `npm run review:patterns`   | Inspect many generated bars — see [Review tooling](#review-tooling)              |
| `npm run review:transforms` | Read what each transformation does to a beat, before and after                   |
| `npm run verify:apl-live`   | **Four real TryAPL requests.** Manual, never in CI                               |
| `npm run screenshot`        | Capture the interface to `docs/`, against a running preview                      |
| `npm run measure:kit`       | Render every voice offline and report its level and length (needs `npm run dev`) |
| `npm run measure:generated` | Render generated bars through the real master chain and check for clipping       |
| `npm run verify:deployment` | Load the published site and check it works. **One real TryAPL request**          |

## How it is put together

Vite, React and TypeScript in strict mode, with CSS Modules over a token layer. No state
library, no component library, no audio library. The dependency list is React and nothing
else.

```
src/
  apl/         everything that touches Dyalog APL, and nothing that does not
    config.ts      the endpoint and the limits; refuses a non-HTTPS endpoint
    wire.ts        the TryAPL Exec format, and the eleven APL error names
    matrix.ts      a pattern → an APL literal, and eight strict lines → a pattern
    operations.ts  the four operations: their APL, their ranges, their explanations
    client.ts      the only network request in the application
    transform.ts   the cache, and the staleness rule
    useTransform.ts  when a request may happen. The whole promise lives here
    reference.ts   what the APL means, in TypeScript — imported by tests only
  generation/  the generator — pure, deterministic, and knows nothing of React
    prng.ts        a 32-bit PRNG; streams derived per track by hashing
    weights.ts     the metrical model and what the macros do to it
    euclidean.ts   Bjorklund's algorithm, alone in a file
    presets.ts     eight sets of dispositions, almost entirely data
    generator.ts   settings → an 8 × 16 matrix
    mutate.ts      how much of a candidate to adopt
    metrics.ts     measurement, for the tests and the review tooling
  pattern/     the matrix, the eight tracks, the mixer, the opening groove
  transport/   the timing arithmetic, the look-ahead scheduler, the transport
  audio/       the AudioContext boundary, the synthesised kit, the DSP pieces
  components/  the sequencer grid, the generator panel, the transport bar
  app/         the creative state and its history, persistence, the shell
  styles/      tokens and the global sheet
```

Four rules shape it.

**The pattern is a matrix and nothing else** — `readonly boolean[][]`, with pure functions
over it. That is what makes `8 16⍴…` a serialisation rather than a translation.

**Generation is pure and outside React.** Nothing in `generation/` imports React, touches a
clock, or draws randomness it was not given. The reducer that drives it is pure too:
Randomise is _handed_ its seed rather than drawing one, which is why every behaviour in this
stage can be tested by stating inputs and reading outputs.

**Per-track random streams, derived by hashing.** Without that, one extra hat would shift
every later draw and rewrite the whole kit — which would make locks impossible and Variation
meaningless.

**The audio clock and the render loop never touch.** See below.

**The APL boundary is one directory and one hook.** Nothing outside `src/apl/` can cause a
request, and inside it only `apply` can. A test forbids any module under `src/` from importing
`reference.ts`, so a silent fallback to the TypeScript implementations is structurally
impossible rather than merely unintended — which is the whole credibility of this stage.

## Audio timing

Unchanged from Stage 1, and deliberately so.

```
a timer wakes about 40 times a second
  → looks 100 ms into the future
  → hands every step in that window to Web Audio, with an exact time
  → Web Audio plays it on the audio thread, to the sample
```

The playhead is a _consequence_ of what was scheduled: it reads the audio clock and reports
the last step it has passed, so a frame drawn late shows where the music is rather than
where it was when the frame was requested.

**A generated pattern takes effect immediately, not on the next bar line.** The matrix is
immutable, so the swap is atomic — a step already handed to Web Audio played from a complete
bar, and the next one plays from a complete bar. There is no window in which half a pattern
can be heard. Bar-quantising was considered and rejected: it would mean the grid showing one
pattern while another played for up to two seconds, and it would put a deadline inside the
scheduler that Stage 1 deliberately keeps clear. With a hundred-millisecond look-ahead a
swap is audible within about a sixteenth anyway.

## Sounds and licensing

**Everything is synthesised in the browser.** There is no audio file in this repository,
none is fetched, and nothing streams from anywhere during playback. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Sound design remains provisional; `Kit` in
`src/audio/kit.ts` is the seam a sampled kit would arrive through.

The generator can now produce bars with forty-odd triggers and seven voices landing on one
sixteenth, which the hand-written opening groove never did. `npm run measure:generated`
renders those bars through the real master chain and reports what comes out: at Density 100
across every preset, peaks sit between −0.4 and −0.9 dBFS with no clipped samples.

## Review tooling

Judging a generator one Randomise press at a time is hopeless — you cannot tell whether a
preset has collapsed, whether one track dominates every result, or whether two seeds are
quietly producing the same bar. `npm run review:patterns` prints them together.

```
npm run review:patterns                     every preset, 12 seeds each
npm run review:patterns -- --seeds 24       more of them
npm run review:patterns -- --preset broken  one preset, in full
npm run review:patterns -- --sweep density  one preset across a macro's range
npm run review:patterns -- --summary        statistics only, no grids
npm run review:patterns -- --plateau        how wide Density's dead zones are
```

It prints readable grids and, per preset, the trigger range, how much the bars repeat
themselves, the share of events off the beat, the largest simultaneous stack, and how close
the two most similar seeds are. It flags duplicates, tracks that never fire, and tracks
whose event count never changes.

There is deliberately **no quality score**. Every number is a count or a ratio, and what
they are for is making bars comparable so that a person can look at forty of them and see
what is wrong. A generator tuned to optimise a number would produce bars that scored well,
which is not the same thing as bars worth listening to.

`npm run review:transforms` does the same job for the transformations, which needed a
different kind of looking: not many bars at once, but one bar before and after.

```
npm run review:transforms                  every operation, on the opening groove
npm run review:transforms -- --generated    and on generated bars from each preset
npm run review:transforms -- --stagger      the operation that was built and rejected
npm run review:transforms -- --locks        what a whole-matrix operation touches
```

Beside each grid it prints whether the kick is still on one, how many of the four beats are
anchored by a kick or a snare, whether the snare still has a backbeat, and what share of events
sits off the sixteenth grid. Those are the things that tell you a beat still has a spine, and
they are what removed Stagger — see
[There was a fifth](#there-was-a-fifth-and-it-was-removed). They are also how two smaller
findings were recorded honestly rather than glossed: **Periodic at a period that does not divide
sixteen** leaves a short gap at the bar line, because `0=3|⍳16` fires on 0, 3, 6, 9, 12 and 15
and then starts again — which is what makes it a cross-rhythm rather than a metronome, but it is
a stumble and the summary says "every few steps" rather than pretending otherwise. And
**Periodic or Euclidean on a hat row can land on top of the other hat**, which the Stage 2
generator deliberately avoids; a transform does not avoid it, because you named that row and the
result must be what APL returned rather than what would have been tidier.

The pattern review earned its place within minutes of existing, and has since found: every seed under a
preset producing exactly the same number of events on every track (Euclidean was pinned at
twenty-two triggers for every seed alive); `periodBias` implemented with the opposite sign to
its own documentation; required steps inflating every count and destroying the repetition
that low Complexity exists to produce; Density dead zones ten points wide; a snare on all
four beats sitting underneath a kick on all four beats; auxiliary tracks scattering isolated
single hits; snares doubling on adjacent sixteenths; and low percussion playing the snare's
figure note for note.

## Accessibility

Everything from Stage 1 still holds — every step is a real button with an accessible name and
`aria-pressed`, one Tab stop for the whole grid, arrow keys and Home and End and Space,
colour never the only signal, WCAG 2.2 AA contrast, and reduced motion honoured.

There is now **no movement in the grid at all.** A step used to swell by eleven per cent as
the playhead crossed it; it is lit instead, by a brighter face inside a warm ring. That began
as a bug fix — the swell pushed the last column three pixels past the grid's right edge, and
because a scroll container's scrollable overflow counts the _transformed_ border boxes of its
descendants, a horizontal scrollbar flickered in and out once per bar at any width where the
sixteen steps fitted exactly. Ink cannot do that, so the hit is ink.

The Stage 2 controls follow the same rules:

- **Randomise, New Seed and Undo are real buttons.** Undo is genuinely `disabled` when there
  is nothing to undo, so a keyboard visitor is told rather than being sent to a button that
  does nothing.
- **Presets are a radio group** in a labelled fieldset, so arrow keys work and the current
  choice is programmatically the checked one. The chosen preset is outlined rather than
  filled, so there is still exactly one solid accent on the page to press.
- **Locks are toggle buttons** carrying `aria-pressed`, labelled "Lock Kick against the
  generator" — because the promise a lock makes is about the generator, not about you.
- **Every slider has a programmatic label and value**, and the numeric readouts beside them
  are `aria-hidden` because the slider already reports its value.

Stage 3 adds a second live region, and both are now **named** — "Playback" and "APL
transform". Two are legitimate: playback and transformation are different concerns and either
can change without the other. Two anonymous ones are not, because a reader arriving at one
has no way to know which is speaking. The transform region reports at most twice per press —
running, then applied or failed — so it reports rather than chatters, and it is `role="status"`
rather than an alert because a failed transform is not an emergency: the beat is untouched and
you can try again.

The transform panel is a labelled region, its selects and number inputs have real labels, and
Peek is a proper disclosure with `aria-expanded` and `aria-controls`. The APL inside it is in
`<pre><code>`, so it is selectable and copyable.

Not yet audited with an actual screen reader, which remains the honest gap.

## Privacy and what leaves the browser

One host is contacted, by one action, carrying one thing.

**What is sent**, when and only when you press Apply with APL:

```json
["", 0, "", "⎕IO←0 ⋄ m←8 16⍴1 0 0 0 … ⋄ m[0;]←¯1⌽m[0;] ⋄ m"]
```

That is the whole payload. A hundred and twenty-eight ones and zeros, four small integers, and
some APL. About three hundred bytes.

**What is not sent, ever:** your tempo, swing, mute states or fader levels; your seed, preset or
macro settings; anything in local storage; any identifier, cookie or account — there is no
account; any telemetry, timing or analytics; any browser detail beyond what HTTP inherently
carries. `credentials: 'omit'` is set explicitly, so no cookie travels even if one existed.

The reason the list is short is not restraint. There is nothing to send because there is nothing
to know: the request is a rhythm and a rotation.

**Your session stays on your machine.** Pattern, seed, preset, macros, locks, tempo, swing and
mixer are kept in `localStorage` and go nowhere. Nothing about a transform is stored — the cache
of APL answers is in memory and dies with the tab.

**Nothing else is fetched at any time.** No CDN, no font service, no analytics, no images from
elsewhere. The `Content-Security-Policy` in `index.html` is the enforcement rather than the
description, and it names exactly one external origin.

## Respecting the device

- **Stopped means stopped.** No scheduler timer, no animation frame, and the `AudioContext`
  suspended.
- **Leaving the tab pauses the transport.**
- **Generation happens once per deliberate action**, never while a control is moving. The
  session write is debounced.
- **One host is reachable, and only when you ask.** The Content-Security-Policy says
  `connect-src 'self' https://tryapl.org` — widened by exactly one origin from Stage 2's
  `'self'`, and by nothing else. No CDN, no analytics, no fonts, no images. Idle, playing or
  editing, the application makes no request at all; pressing Apply makes one.

## Testing

```bash
npm test          # 349 unit and component tests, in jsdom
npm run test:e2e  # 132 end-to-end runs across three browser projects
```

**Not one of them makes a live TryAPL request.** The unit tests inject a fake client; the
end-to-end suite intercepts the endpoint in the browser and answers as the real service does,
including its CORS preflight. The mock computes its reply from the matrix it was actually
sent, using the reference implementations, because a fake returning a fixed answer would pass
every test while proving almost nothing.

The generator is tested as **properties, not snapshots**. It is expected to be tuned again —
that is what the review tooling is for — and a test pinning twenty-four bars cell by cell
would fail on every improvement and tell nobody anything. So what is asserted is what must
stay true whatever the weights become: the shape, the determinism, the locks, and the
direction each control moves things in. The statistical tests sample forty seeds and assert a
direction; a single seed is allowed to disobey, the population is not.

Four real bugs were found by these tests rather than by inspection: Syncopation at 100 putting
a _smaller_ share of events off the beat than at 0; committing any macro regenerating the bar,
so that touching Variation silently replaced the curated opening; a drag whose first crossed
cell already held the painted value banking no history and swallowing the rest of the drag;
and Variation's track-spread saturating by the middle of its range.

Stage 3 added a fifth, and the end-to-end suite found it on WebKit alone.
`controller.abort(reason)` is supposed to make `fetch` reject **with that reason**; Chromium
does, and WebKit rejects with a bare `AbortError` however it was aborted. Reading the reason
off the exception therefore made a timeout indistinguishable from a superseded request — and a
superseded request is deliberately silent, so a visitor on Safari whose transform timed out was
shown nothing at all. The client now keeps its own note of why it aborted, which is both simpler
and true everywhere.

Three browser projects, because Playwright's WebKit is built without Web Audio —
`AudioContext` is not on the window at all. So the phone layout is checked on the engine
phones run, touch is checked on an engine that can make a sound, and the audio tests ask the
page whether Web Audio exists and skip themselves rather than pretending.

What no test covers is whether it grooves. That is judged by ear — and, for the
transformations, with `npm run review:transforms`, which prints each operation's before and
after with the few numbers that say whether a rhythm still has a spine: whether the kick is
still on one, how many beats are anchored, whether the snare still has a backbeat, and what
share of events sits off the grid. It is what removed Stagger.

## Deployment

One workflow. `verify` and `e2e` must both pass before the Pages artifact is built, and the
deploy step abandons itself if `main` has moved on. The published base path comes from
`actions/configure-pages`, so renaming the repository needs no code change.

## Where APL goes next

APL now transforms. It does not yet generate, and it never will time.

```
now:     TypeScript generates  →  APL transforms  →  Web Audio plays
later:   APL generates         →  APL transforms  →  Web Audio plays
never:   APL times anything
```

The generator is already a pure function from settings to a matrix, so replacing its innards
changes nothing above it — and `euclidean.ts` is kept small and alone precisely so that
Bjorklund's recursion sits beside the one line of APL that does the same thing.

What a later stage has to solve before generation can move is not the APL. It is the request
budget. A generator that ran remotely would want a request per Randomise, which is a request
per press of the most-pressed button in the application — and that is exactly the shape this
stage promised not to build. The likely answer is batching: ask APL for several candidate bars
at once and spend them locally. That is a design problem, not a translation problem, and it is
not this stage's.

An APL editor is a larger question again, because everything in
[There is no APL editor](#there-is-no-apl-editor) stops applying the moment arbitrary source is
allowed.

## Licence

[MIT](LICENSE). An independent personal project, not a Dyalog product.
