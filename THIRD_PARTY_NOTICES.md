# Third-party notices

Work by others that APL Beats includes, and the terms it is used under. This file is
documentation: nothing here is shown inside the application.

## Audio

Three kinds, and they are quite different in provenance. One is generated in the browser and
involves nobody else's work. Nine kits are somebody's **recordings, copied unchanged**. One kit is
**rendered from somebody's DSP implementation and its audio resources**, and ships only the render.
The obligations differ, so the three are documented separately rather than under one heading about
"samples".

### The synthesised kit — no third-party audio

**APL Beats Synth** is generated in the browser at the moment it is played, by the code in
[`src/audio/kit.ts`](src/audio/kit.ts). No sample is involved, nothing is fetched, and no audio
from any machine is reproduced. The voices are modelled on how the instruments they are named
after behave, and on the published designs of the classic drum machines — a pitch-swept sine for
the kick, a bank of square waves at inharmonic ratios through a narrow high band for the hats,
overlapping noise bursts for the clap. Those are techniques, not recordings.

It remains the default kit and the fallback whenever a sampled kit will not load, and it will not
be removed.

### The sampled kits — smpldsnds/drum-machines

Stage 4 bundles selected samples from a third-party collection: nine of its ten packs are
included, and one is not.

- **Source:** <https://github.com/smpldsnds/drum-machines>
- **Commit:** `a894cb8c72abe15b05e7b4fd4b8ee561c0f9e960` (11 April 2024)
- **Upstream statement:** _"A collection of public domain samples of different drum machines"_
- **Where that statement appears:** `README.md`. **The repository contains no LICENSE file.**
- **Bundled at:** [`public/audio/`](public/audio/), 473.4 KB across 71 files
- **Machine-readable manifest:** [`src/audio/kits/provenance.ts`](src/audio/kits/provenance.ts)
- **Checksums:** [`src/audio/kits/checksums.json`](src/audio/kits/checksums.json)

#### What the audit established

The collection was read in full before any audio was copied — every pack, every metadata file and
every text file in the tree. Three findings shaped what is here.

**The licence basis is thin for most packs, and that is recorded rather than dressed up.** For
eight of the nine included packs, the single line in the upstream README is the entire licence
statement; there is no per-pack notice, no LICENSE file and no SPDX identifier anywhere. What the
audit did establish is the negative, and it is worth stating precisely: **no pack in the collection
carries any restriction inconsistent with redistribution.** There is no non-commercial clause, no
no-redistribution clause, and no licence text of any kind in any pack.

**The TR-808 pack is the exception, and is well documented.** It ships Michael Fischer's notice of
9 August 1994, which names the machine, its serial number (103852), the recording equipment, the
sampling method and the resolution, and states the samples are _"ABSOLUTELY FREE"_. That notice is
bundled unaltered beside the audio it describes, at
[`public/audio/tr-808/TR808.TXT`](public/audio/tr-808/TR808.TXT), and is served with the
application. Authorship and history are not discarded merely because a collection describes its
contents as public domain.

**There are no WAV files upstream.** Every pack is published as lossy `.ogg` and `.m4a` only. There
is therefore no lossless original to prefer, and nothing here has been re-encoded, trimmed,
normalised or otherwise processed: the bundled files are byte-for-byte copies of upstream's `.m4a`,
which the checksums file exists to prove. `.m4a` was chosen over `.ogg` because AAC decodes in
every browser this application supports.

#### Excluded

**Univox Micro Rhythmer 12** (`Micro-Rhythmer-12`) is not included. It contains three samples — a
closed hat, an open hat and a snare — and no bass drum. Eight rows cannot be filled from three
sounds without six of them being duplicates. **This exclusion is for coverage, not for licensing.**
Nothing in the collection was excluded on provenance grounds.

#### Playback processing

The bundled files are unaltered, but they are not played at unity. Each is scaled by a measured
gain so that at full level it peaks where its row is calibrated to peak, less 0.6 dB of headroom —
necessary because several of the lossy upstream files decode above full scale. The row targets are
pinned in [`src/audio/kits/calibration.ts`](src/audio/kits/calibration.ts), which explains at
length why they are recorded as data rather than re-measured from the synthesised kit each time.

Seven rows across four kits are filled by a substitution, because the machine had no instrument
for that row; of those, **three voices in two kits** are additionally played at a fixed rate other
than 1.0 — the MFB-512's rim at 1.45, and the Casio SK-1's clap at 1.2 and high percussion at 1.6 —
so that a borrowed sound does not read as the same instrument played twice. Every substitution is
listed in the manifest and in the README.

No filtering, equalisation or dynamics are applied to any individual sample. The master chain is the
same one the synthesised kit has always used.

#### Which files are bundled, and what they are

##### TR-808

Upstream folder: `TR-808`, notice: `TR808.TXT`

| APL Beats row | Upstream file         | Instrument                          |
| ------------- | --------------------- | ----------------------------------- |
| Kick          | `kick/bd5050.m4a`     | Bass Drum, tone and decay centred   |
| Snare         | `snare/sd5050.m4a`    | Snare Drum, tone and snappy centred |
| Closed Hat    | `hihat-close/ch.m4a`  | Closed Hi Hat                       |
| Open Hat      | `hihat-open/oh50.m4a` | Open Hi Hat, decay centred          |
| Clap          | `clap/cp.m4a`         | Hand Clap                           |
| Low Perc      | `conga-low/lc50.m4a`  | Low Conga, tuning centred           |
| High Perc     | `conga-hi/hc50.m4a`   | High Conga, tuning centred          |
| Rim           | `rimshot/rs.m4a`      | Rim Shot                            |

##### LinnDrum LM-2

Upstream folder: `LM-2`

| APL Beats row | Upstream file  | Instrument                         |
| ------------- | -------------- | ---------------------------------- |
| Kick          | `kick.m4a`     | Bass drum                          |
| Snare         | `snare-m.m4a`  | Snare, middle of three tunings     |
| Closed Hat    | `hhclosed.m4a` | Closed hi-hat                      |
| Open Hat      | `hhopen.m4a`   | Open hi-hat                        |
| Clap          | `clap.m4a`     | Hand clap                          |
| Low Perc      | `conga-l.m4a`  | Low conga (151 Hz)                 |
| High Perc     | `conga-h.m4a`  | High conga (320 Hz)                |
| Rim           | `stick-m.m4a`  | Sidestick, middle of three tunings |

##### CR-8000

Upstream folder: `Roland-CR-8000`

| APL Beats row | Upstream file      | Instrument          |
| ------------- | ------------------ | ------------------- |
| Kick          | `kick.m4a`         | Bass drum           |
| Snare         | `snare.m4a`        | Snare drum          |
| Closed Hat    | `hihat-closed.m4a` | Closed hi-hat       |
| Open Hat      | `hihat-open.m4a`   | Open hi-hat         |
| Clap          | `clap.m4a`         | Hand clap           |
| Low Perc      | `conga-low.m4a`    | Low conga (190 Hz)  |
| High Perc     | `conga-high.m4a`   | High conga (302 Hz) |
| Rim           | `rimshot.m4a`      | Rimshot             |

##### Drumtraks

Upstream folder: `Sequential-Circuits-Drumtraks`

| APL Beats row | Upstream file      | Instrument                            |
| ------------- | ------------------ | ------------------------------------- |
| Kick          | `DT_Kick.m4a`      | Bass drum                             |
| Snare         | `DT_Snare.m4a`     | Snare drum                            |
| Closed Hat    | `DT_Closedhat.m4a` | Closed hi-hat                         |
| Open Hat      | `DT_Openhat.m4a`   | Open hi-hat                           |
| Clap          | `DT_Clap.m4a`      | Hand clap                             |
| Low Perc      | `DT_Tom02.m4a`     | Tom 2, the lower of the two (95 Hz)   |
| High Perc     | `DT_Tom01.m4a`     | Tom 1, the higher of the two (160 Hz) |
| Rim           | `DT_Rimshot.m4a`   | Rimshot                               |

##### Casio RZ-1

Upstream folder: `Casio-RZ1`

| APL Beats row | Upstream file      | Instrument                           |
| ------------- | ------------------ | ------------------------------------ |
| Kick          | `kick.m4a`         | Bass drum                            |
| Snare         | `snare.m4a`        | Snare drum                           |
| Closed Hat    | `hihat-closed.m4a` | Closed hi-hat                        |
| Open Hat      | `hihat-open.m4a`   | Open hi-hat                          |
| Clap          | `clap.m4a`         | Hand clap                            |
| Low Perc      | `tom-3.m4a`        | Tom 3, the lowest of three (95 Hz)   |
| High Perc     | `tom-1.m4a`        | Tom 1, the highest of three (151 Hz) |
| Rim           | `clave.m4a`        | Clave                                |

##### MFB-512

Upstream folder: `MFB-512`

| APL Beats row | Upstream file      | Instrument        |
| ------------- | ------------------ | ----------------- |
| Kick          | `kick.m4a`         | Bass drum         |
| Snare         | `snare.m4a`        | Snare drum        |
| Closed Hat    | `hihat-closed.m4a` | Closed hi-hat     |
| Open Hat      | `hihat-open.m4a`   | Open hi-hat       |
| Clap          | `clap.m4a`         | Hand clap         |
| Low Perc      | `tom-low.m4a`      | Low tom (101 Hz)  |
| High Perc     | `tom-hi.m4a`       | High tom (143 Hz) |
| Rim           | `tom-mid.m4a`      | Mid tom (120 Hz)  |

##### Yamaha MR10

Upstream folder: `Yamaha-MR10`

| APL Beats row | Upstream file | Instrument                   |
| ------------- | ------------- | ---------------------------- |
| Kick          | `kick1.m4a`   | Bass drum, the second of two |
| Snare         | `snare.m4a`   | Snare drum                   |
| Closed Hat    | `chihat.m4a`  | Closed hi-hat                |
| Open Hat      | `ohihat.m4a`  | Open hi-hat                  |
| Clap          | `shortsn.m4a` | Short snare                  |
| Low Perc      | `lowtom.m4a`  | Low tom (113 Hz)             |
| High Perc     | `hitom.m4a`   | High tom (226 Hz)            |
| Rim           | `shorthi.m4a` | Short high percussion        |

##### 808 Mini

Upstream folder: `808-mini`

| APL Beats row | Upstream file    | Instrument                   |
| ------------- | ---------------- | ---------------------------- |
| Kick          | `kick.m4a`       | Bass drum                    |
| Snare         | `snare-2.m4a`    | Snare, second of three       |
| Closed Hat    | `hhclosed-1.m4a` | Closed hi-hat, first of two  |
| Open Hat      | `hhopen-1.m4a`   | Open hi-hat, first of two    |
| Clap          | `snare-3.m4a`    | Snare, third of three        |
| Low Perc      | `tom-low.m4a`    | Low tom (95 Hz)              |
| High Perc     | `tom-high.m4a`   | High tom (190 Hz)            |
| Rim           | `hhclosed-2.m4a` | Closed hi-hat, second of two |

##### Casio SK-1

Upstream folder: `Casio-SK1`

| APL Beats row | Upstream file    | Instrument        |
| ------------- | ---------------- | ----------------- |
| Kick          | `kick.m4a`       | Bass drum         |
| Snare         | `snare.m4a`      | Snare drum        |
| Closed Hat    | `hithat.m4a`     | Closed hi-hat     |
| Open Hat      | `hihat-open.m4a` | Open hi-hat       |
| Clap          | `snare.m4a`      | Snare drum        |
| Low Perc      | `tom-low.m4a`    | Low tom (226 Hz)  |
| High Perc     | `tom-low.m4a`    | Low tom (226 Hz)  |
| Rim           | `tom-hi.m4a`     | High tom (905 Hz) |

### The rendered kit — andremichelle/tr-909

Stage 5.2 adds one kit that is not a sample pack. **The TR-909 kit is rendered offline from André
Michelle's MIT-licensed TR-909 DSP implementation and its bundled audio resources. APL Beats does
not redistribute the upstream `.raw` resources themselves; it distributes only the resulting
rendered WAV files.**

Unlike the nine sampled kits above, this one is not copied from a set of finished drum-machine
samples. The eight files were produced here, by running that DSP offline and writing down what came
out.

- **Source:** <https://github.com/andremichelle/tr-909>
- **Author:** André Michelle
- **Commit:** `11d423382d6d9705bd37a42b533e3b3c27442be7` (11 March 2024)
- **Licence:** **MIT** — reproduced in full below
- **Bundled at:** [`public/audio/tr-909/`](public/audio/tr-909/), 252.0 KB across 8 files
- **Rendered by:** [`scripts/render-tr909.mjs`](scripts/render-tr909.mjs), `npm run render:tr909`
- **Machine-readable manifest:** [`src/audio/kits/tr909-render.json`](src/audio/kits/tr909-render.json)
  — per-voice settings, sample counts, peaks and SHA-256 of every rendered file, plus SHA-256 of
  every upstream file the render read

#### The licence

> MIT License
>
> Copyright (c) 2022 André Michelle
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
> OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

#### What the audit established

- The MIT licence is at the repository root and covers the repository. It permits use,
  modification, redistribution and sale, of the source and of works derived from it, on one
  condition: that the notice above travels with it. It does, in this file.
- **One carve-out exists and is not used.** The upstream README credits **Isaac Cotec** for the
  Roland, TR-909 and Rhythm Composer **logo SVGs**. APL Beats uses no logo, no artwork, no
  interface asset and no font from the project — only the DSP source and the audio resources that
  DSP reads. Nothing credited to Isaac Cotec is copied, rendered or referenced.
- The upstream README credits **Sascha Kaltenschnee** for lending the hardware used during
  development; it makes no separate authorship or licensing claim for the resources APL Beats uses.
- The `.raw` files under `resources/` carry no separate licence statement and sit under the
  repository's MIT licence with everything else. **None of them is redistributed here.** They are
  read by the renderer as inputs and do not ship; what ships is the rendered WAV output.
- No Roland trade dress of any kind is reproduced. See **Manufacturer names**, below, which applies
  to this kit exactly as it does to the sampled ones.

#### How the files were produced

Deterministically, so that the claim can be checked rather than believed.

`npm run render:tr909` downloads the upstream compiled modules and audio resources at the pinned commit
into a gitignored cache, instantiates each voice exactly as upstream's own `createVoice` does, and
runs it in the same 128-frame blocks upstream processes in until the voice reports itself finished.
Every front-panel control is left at the upstream preset default. The one uniform choice is that
each hit is struck at the top of upstream's step-level range — `Linear(-18, 0)` dB — rather than at
an ordinary step; that is the same offset for all eight voices, so the machine's own balance between
them survives, and it keeps a bit and a half of the sixteen available rather than spending it on a
level APL Beats sets for itself anyway.

Only the tail below −96 dBFS is trimmed, which is quieter than a 16-bit file can represent. There is
no normalisation, no limiting, no equalisation and no editing.

`npm run render:tr909 -- --check` re-renders and compares against the shipped files. Two independent
runs produce byte-identical output on all eight.

#### Format, and whether it is lossless

**Not quite, and here is the one place it is not.** The DSP computes in 32-bit float; the files are
16-bit PCM WAV, mono, 44.1 kHz. That quantisation — rounded, no dither — is the single lossy step in
the chain, about 96 dB below full scale. The quietest voice, the rim shot, still sits about 79 dB
above that floor after its playback gain, so it is inaudible; but it is a real step and the manifest
records `"lossless": false` rather than claiming otherwise.

16-bit PCM was chosen over a lossy encode deliberately. It costs about 250 kB, and it buys a
byte-for-byte reproducible pipeline — which is what makes `--check` mean anything.

#### Which files are rendered, and from what

Upstream classes and audio resources, all paths relative to the upstream repository root.

| APL Beats row | Instrument    | Upstream class        | Resources read                              |
| ------------- | ------------- | --------------------- | ------------------------------------------- |
| Kick          | Bass drum     | `BassdrumVoice`       | `bassdrum-attack.raw`, `bassdrum-cycle.raw` |
| Snare         | Snare drum    | `SnaredrumVoice`      | `snare-tone.raw`, `snare-noise.raw`         |
| Closed Hat    | Closed hi-hat | `BasicTuneDecayVoice` | `closed-hihat.raw`                          |
| Open Hat      | Open hi-hat   | `BasicTuneDecayVoice` | `opened-hihat.raw`                          |
| Clap          | Hand clap     | `BasicTuneDecayVoice` | `clap.raw`                                  |
| Low Perc      | Low tom       | `BasicTuneDecayVoice` | `tom-low.raw`                               |
| High Perc     | High tom      | `BasicTuneDecayVoice` | `tom-hi.raw`                                |
| Rim           | Rim shot      | `BasicTuneDecayVoice` | `rim.raw`                                   |

`BassdrumVoice` and `SnaredrumVoice` live in `typescript/audio/tr909/dsp/bassdrum.ts` and
`snaredrum.ts`; `BasicTuneDecayVoice` in `typescript/audio/tr909/dsp/basic-voice.ts`.

**There are no substitutions in this kit.** The TR-909 has a real instrument for all eight rows. Its
mid tom, crash and ride are not used, because APL Beats has eight rows and not eleven.

### Manufacturer names

Applies to every kit above, sampled and rendered alike.

Machine names are used textually, to identify which set of sounds is playing. **APL Beats is an
independent project and is not affiliated with or endorsed by Roland, Linn, Sequential Circuits,
Casio, Yamaha, MFB or any other manufacturer named here.** No logos, product artwork or trade dress
appear in this repository or in the application.

## Code

The dependencies are listed in [`package.json`](package.json) and their licences travel
with them in `node_modules`; none is vendored into this repository. React and Vite are
MIT-licensed, as is everything else in the build.

## Typography

The interface asks for whatever grotesque the device already has, through the `system-ui`
stack in [`src/styles/tokens.css`](src/styles/tokens.css). One font is bundled, and only
for the APL.

**APL387**, Dyalog's redrawn successor to Adrian Smith's APL385 Unicode.

- Source: <https://github.com/Dyalog/APL387>
- Licence: **public domain**, released under [The Unlicence](https://unlicense.org/), which
  places no condition on redistribution.
- Bundled as: [`src/assets/fonts/APL387-subset.woff2`](src/assets/fonts/APL387-subset.woff2),
  23 KB.

The upstream repository does not commit a built TTF — it is produced by their CI and
published to their Pages site. [`scripts/subset-font.py`](scripts/subset-font.py) fetches it
from there and subsets it to the Unicode blocks APL glyphs live in, which it lists; the
resulting WOFF2 is committed, so contributors never need to run it. Re-run it only to pick
up an upstream revision.

A web font was avoided for Stages 1 and 2 and is here now for one reason: `⍴`, `⌽`, `⍳` and
`¯` render at inconsistent widths, or not at all, in the monospace fonts most systems
supply, and Peek exists to show APL as APL is written. A licence that permits
redistribution without condition made bundling the honest option — the alternatives were
fetching from someone else's CDN at runtime, which this application does not do, or hoping
the visitor already had the font, which most do not.

Loaded with `font-display: swap` and falling back to the platform monospace, so the
interface is legible before it arrives and remains legible if it never does.
