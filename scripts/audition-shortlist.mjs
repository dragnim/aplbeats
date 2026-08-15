/*
 * The Lead and Pad candidates to listen to, and why each one is here.
 *
 * Data, in its own file, because the shortlist is the part of this work most worth arguing with.
 * `survey-jupiter4.mjs` measured every playable preset in the library; this is the judgement made
 * from those measurements, and it is a judgement about **range** rather than about quality:
 *
 *   the numbers are good at saying "these six are the same kind of bright";
 *   they are useless at saying which one belongs in the product.
 *
 * Stage 8 chose by score and shipped a Lead that measured best and sounded worst. So nothing here
 * is ranked. Every candidate carries a `character` — the thing it is here to represent — and the
 * bench presents them in an order chosen to make differences audible, not to imply a winner.
 *
 * `role` is what the sound is being auditioned *for*, and it deliberately need not match the
 * upstream category. An excellent sustained patch filed under Misc is still a candidate for our
 * Pad, and its true provenance is recorded either way.
 */

/**
 * Every playable preset in the Lead category, and two from Misc that are leads in all but filing.
 *
 * All twelve, rather than a selection, because twelve *is* the shortlist size and taking the lot
 * is the honest answer to "inspect the complete available Lead material". The two extras are here
 * because the survey found them: `Baby brass` is a full-scale brass lead with a 52 ms attack, and
 * `jp4 - Fake Flute` is the softest round lead in the library. Neither is an effect.
 */
export const LEAD_CANDIDATES = [
  {
    id: 'lead-blip',
    preset: 'Blip Lead',
    category: 'Lead',
    folder: 'Lead/Audio/Blip Lead-SAMPLES',
    character: 'bright, plucky, short',
    note: 'What Stage 8 shipped. Here as the reference to beat: it measured brightest by four and at full scale, which is exactly how it was chosen and exactly why it grates.',
    production: 'lead',
  },
  {
    id: 'lead-jp',
    preset: 'JP lead',
    category: 'Lead',
    folder: 'Lead/Audio/JP lead-SAMPLES',
    character: 'round, immediate, level',
    note: 'The fastest attack in the library at 1.9 ms, and the darkest of the immediate leads at 473 Hz. The opposite corner from Blip Lead.',
  },
  {
    id: 'lead-4',
    preset: '4 lead',
    category: 'Lead',
    folder: 'Lead/Audio/4 lead-SAMPLES',
    character: 'warm, level, mid',
    note: '64 ms attack holding at three-quarters. Middle of the range in every measure, which is a reason to hear it rather than to skip it.',
  },
  {
    id: 'lead-bold',
    preset: 'Bold Lead',
    category: 'Lead',
    folder: 'Lead/Audio/Bold Lead-SAMPLES',
    character: 'slow swell',
    note: 'A 1.9 s swell. Almost certainly too slow for sixteenths, and included because "too slow" is a thing to hear once rather than assume.',
  },
  {
    id: 'lead-chunky',
    preset: 'Chunky',
    category: 'Lead',
    folder: 'Lead/Audio/Chunky-SAMPLES',
    character: 'bright, decaying',
    note: '30 ms attack, 1171 Hz, decaying to half by two seconds. A plucked bright lead without Blip Lead’s spike.',
  },
  {
    id: 'lead-gone-away',
    preset: 'Gone Away Forever',
    category: 'Lead',
    folder: 'Lead/Audio/Gone Away Forever-SAMPLES',
    character: 'full scale, sustained',
    note: 'Full scale like Blip Lead but 320 ms in and holding at 5×. The loud-and-sustained corner.',
  },
  {
    id: 'lead-high-rise',
    preset: 'High Rise',
    category: 'Lead',
    folder: 'Lead/Audio/High Rise-SAMPLES',
    character: 'swelling, very sustained',
    note: 'Holds at 27–47× its own attack. Quiet at source, which the working gain fixes.',
  },
  {
    id: 'lead-cat-brush',
    preset: 'jp4 - Cat Brush',
    category: 'Lead',
    folder: 'Lead/Audio/jp4 - Cat Brush-SAMPLES',
    character: 'soft attack, sustained',
    note: '293 ms and level at 5×. Between a lead and a pad, which is a useful place to hear.',
  },
  {
    id: 'lead-noisy',
    preset: 'jp4 - Noisy Lead',
    category: 'Lead',
    folder: 'Lead/Audio/jp4 - Noisy Lead-SAMPLES',
    character: 'nasal, level',
    note: 'Level throughout at 697 Hz. The nasal end of the range.',
  },
  {
    id: 'lead-sticky',
    preset: 'JP4 - Sticky',
    category: 'Lead',
    folder: 'Lead/Audio/JP4 - Sticky-SAMPLES',
    character: 'dark, soft, sustained',
    note: 'The darkest thing in the category at 284 Hz. If Blip Lead is tiring, this is the far side of that complaint.',
  },
  {
    id: 'lead-sad-wow',
    preset: 'Sad Wow',
    category: 'Lead',
    folder: 'Lead/Audio/Sad Wow-SAMPLES',
    character: 'bright, swelling, very sustained',
    note: 'Bright at 1025 Hz and holds at 30×. A filter sweep by another name, which may be lovely or may be seasick over sixteen bars.',
  },
  {
    id: 'lead-thick-swishy',
    preset: 'Thick Swishy',
    category: 'Lead',
    folder: 'Lead/Audio/Thick Swishy-SAMPLES',
    character: 'sharp, aggressive, fast decay',
    note: 'Full scale, 17 ms, down to a quarter by two seconds. The aggressive corner.',
  },
  {
    id: 'lead-baby-brass',
    preset: 'Baby brass',
    category: 'Misc',
    folder: 'Misc/Audio/Baby brass-SAMPLES',
    character: 'brass, full scale, level',
    note: 'Filed under Misc, plainly a lead: 52 ms, full scale, level for its whole length. The kind of patch a Jupiter is bought for.',
  },
  {
    id: 'lead-fake-flute',
    preset: 'jp4 - Fake Flute',
    category: 'Misc',
    folder: 'Misc/Audio/jp4 - Fake Flute-SAMPLES',
    character: 'soft, breathy, round',
    note: 'Filed under Misc. The softest round lead in the library at 276 Hz, holding just under 2×.',
  },
];

/**
 * Twelve Pads, plus two string patches from Misc that are pads in all but filing.
 *
 * Four of the sixteen Pads presets are left out — JP4 Celts Pad, JP4 Greeks Pad, JP4 Saxons Pad
 * and jp4 Potato King — and the reason is duplication of *character* rather than any measured
 * weakness: the first three sit between candidates already on the list, and Potato King's 647 ms
 * swell is covered by JP4 Normans Pad. If nothing here satisfies, they are one line each to add
 * back.
 *
 * The five tribe-named pads are date-stamped patch dumps inside sensibly named folders — the
 * audio sits in `JP4 Lombards Pad/(2011319 2737)/`. The bench shows the folder's name, because
 * "JP4 Lombards Pad" is what somebody would call it and "(2011319 2737)" is when it was dumped.
 */
export const PAD_CANDIDATES = [
  {
    id: 'pad-shimmer',
    preset: 'jp4 - Shimmer',
    category: 'Pads',
    folder: 'Pads/Audio/jp4 - Shimmer-SAMPLES',
    character: 'soft attack, barely sustains',
    note: 'What Stage 8 shipped, and the survey shows why it disappoints: at 1.03/0.96/0.87 it holds less than almost every other pad here. It was chosen for having the fastest attack of the pads, which turns out to be the wrong question.',
    production: 'pad',
  },
  {
    id: 'pad-unison',
    preset: 'JP4 - Unison Pad',
    category: 'Pads',
    folder: 'Pads/Audio/JP4 - Unison Pad-SAMPLES',
    character: 'fast attack, level',
    note: '57 ms — the fastest pad attack in the library — and level rather than decaying. No loop metadata.',
  },
  {
    id: 'pad-jelly-plate',
    preset: 'Jelly Plate',
    category: 'Pads',
    folder: 'Pads/Audio/Jelly Plate-SAMPLES',
    character: 'full scale, sustained, mid',
    note: 'The only full-scale pad. 222 ms and holds at 5.5×, with a real loop at 8.1 s.',
  },
  {
    id: 'pad-singing-multi',
    preset: 'jp4 - Singing multi',
    category: 'Pads',
    folder: 'Pads/Audio/jp4 - Singing multi-SAMPLES',
    character: 'vocal, sustained',
    note: '122 ms, holds at 3.6×, loop at 6.6 s. Very quiet at source.',
  },
  {
    id: 'pad-2737',
    preset: 'JP4 Lombards Pad',
    category: 'Pads',
    folder: 'Pads/Audio/JP4 Lombards Pad/(2011319 2737)',
    character: 'very dark, sustained',
    note: 'The darkest pad in the library at 149 Hz, holding at 8.4×. A patch dump rather than a named preset — the name is its date.',
  },
  {
    id: 'pad-233538',
    preset: 'JP4 Normans Pad',
    category: 'Pads',
    folder: 'Pads/Audio/JP4 Normans Pad/(2011318 233538)',
    character: 'slow swell, very sustained',
    note: '926 ms in and still rising at one second — holds at 26×. The most pad-like pad by the numbers, and the one most likely to be too slow for a sixteenth-note phrase.',
  },
  {
    id: 'pad-1400',
    preset: 'JP4 Picts Pad',
    category: 'Pads',
    folder: 'Pads/Audio/JP4 Picts Pad/(2011319 1400)',
    character: 'bright, swelling',
    note: '776 ms at 1123 Hz, holding near 4×. The bright end of the swelling pads.',
  },
  {
    id: 'pad-215327',
    preset: 'JP4 Romans Pad',
    category: 'Pads',
    folder: 'Pads/Audio/JP4 Romans Pad/(2011318 215327)',
    character: 'brightest, slowest',
    note: 'The brightest pad at 1521 Hz and the slowest attack at 1.3 s. Included as the far corner.',
  },
  {
    id: 'pad-0553',
    preset: 'JP4 Vikings Pad',
    category: 'Pads',
    folder: 'Pads/Audio/JP4 Vikings Pad/(2011319 0553)',
    character: 'dark, immediate, sustained',
    note: '150 ms at 265 Hz holding at 3×. Dark like 2737 but arrives twice as fast.',
  },
  {
    id: 'pad-visigoth',
    preset: 'JP4 Visigoth Pad',
    category: 'Pads',
    folder: 'Pads/Audio/JP4 Visigoth Pad',
    character: 'bright, immediate',
    note: '139 ms at 1450 Hz. No loop metadata, so the natural variant is what it has.',
  },
  {
    id: 'pad-pwm-lady',
    preset: 'PWM Lady',
    category: 'Pads',
    folder: 'Pads/Audio/PWM Lady-SAMPLES',
    character: 'full scale, sustained, wide',
    note: 'Full scale, 291 ms, holds at 13×. No loop metadata.',
  },
  {
    id: 'pad-noisy',
    preset: 'Noisy Pad',
    category: 'Pads',
    folder: 'Pads/Audio/Noisy Pad-SAMPLES',
    character: 'noisy swell, very sustained',
    note: '722 ms and holds at 88×. Whether "noisy" is texture or hiss is exactly the sort of thing measurement cannot say.',
  },
  {
    id: 'pad-eager-string',
    preset: 'Eager String',
    category: 'Misc',
    folder: 'Misc/Audio/Eager String-SAMPLES',
    character: 'string, sustained',
    note: 'Filed under Misc. 303 ms, holds at 14–15×, level across two seconds. A string pad by any reasonable description.',
  },
  {
    id: 'pad-pwm-strings',
    preset: 'PWM Strings',
    category: 'Misc',
    folder: 'Misc/Audio/PWM Strings-SAMPLES',
    character: 'string, sustained, loop',
    note: 'Filed under Misc, and one of the few outside Pads with real loop metadata — 5.2 s. 237 ms and holds at 5×.',
  },
];

/**
 * The two production sounds nobody is asking to replace, as references.
 *
 * Prepared exactly as production prepares them, so "is this Lead as good as Keys?" is a question
 * the bench can actually answer rather than one that needs two browser tabs.
 */
export const REFERENCE_CANDIDATES = [
  {
    id: 'ref-bass',
    preset: '4 Bass',
    category: 'Bass',
    folder: 'Bass/Audio/4Bass',
    character: 'production Bass',
    note: 'Shipping, and staying. Here as a reference for what already works.',
    production: 'bass',
  },
  {
    id: 'ref-keys',
    preset: 'Petals Piano',
    category: 'Keys',
    folder: 'Keys/Audio/Petals Piano-SAMPLES',
    character: 'production Keys',
    note: 'Shipping, and staying — and a serious candidate for the default Tone sound, which is why it is easy to reach here.',
    production: 'keys',
  },
];

export const CANDIDATES = [
  ...REFERENCE_CANDIDATES.map((entry) => ({ ...entry, role: 'reference' })),
  ...LEAD_CANDIDATES.map((entry) => ({ ...entry, role: 'lead' })),
  ...PAD_CANDIDATES.map((entry) => ({ ...entry, role: 'pad' })),
];
