# Enharmonic key picker

## Context

Every key and transposed chord is spelled with sharps today. `CHROMATIC` in
`src/utils/chordpro.ts` is a sharps-only scale, and it drives both `transposeChord` (G up
three semitones gives `A#`, never `Bb`) and the `KeyChips` row. Picking the fourth chip
stores `A#` as the song's key. A song typed in as `Bb` (Add/Edit Song, or a `{key: Bb}`
directive) never shows an active chip, because `KeyChips` matches the label text
(`k === active`) and no chip says `Bb`.

The replacement follows a reference key picker (the one in the chat screenshot). It lists
every key that has a key signature, shows each key's semitone offset above it and its
relative minor below it, and lets the chip you tap decide the spelling.

Decisions made in chat:

- **15 chips** (the key-signature keys), in pitch order. C♯/D♭, F♯/G♭ and B/C♭ each get
  two chips.
- **Offsets go the nearest way.** A MusicXML score moves by at most half an octave.
- **Textbook chord spelling, with the odd ones simplified** (details below).
- **The relative minor is a label only.** Songs still have a major key.

## Goals

- You pick the key's spelling, and every chord on the chart follows it.
- Keys are stored exactly as picked (`Db` stays `Db`).
- A song whose key is `Bb` highlights the B♭ chip.
- Sheet music moves no more than 6 semitones for a key change.

## Out of scope

- Minor keys as song keys. The `KEY_RE` in Add/Edit Song still takes roots only.
- Capo, which is cut. See `docs/progress-checklist.md`.
- Re-keying MusicXML *exports*. They still go out as imported.
- Respelling the tuner's note names.

## The key list (`src/utils/keys.ts`, new)

```ts
export const KEYS = [
  { name: "C",  minor: "Am"  }, { name: "C#", minor: "A#m" }, { name: "Db", minor: "Bbm" },
  { name: "D",  minor: "Bm"  }, { name: "Eb", minor: "Cm"  }, { name: "E",  minor: "C#m" },
  { name: "F",  minor: "Dm"  }, { name: "F#", minor: "D#m" }, { name: "Gb", minor: "Ebm" },
  { name: "G",  minor: "Em"  }, { name: "Ab", minor: "Fm"  }, { name: "A",  minor: "F#m" },
  { name: "Bb", minor: "Gm"  }, { name: "B",  minor: "G#m" }, { name: "Cb", minor: "Abm" },
];
```

- Stored and parsed values keep ASCII `#`/`b`, as they do now. Labels use `♯`/`♭` only
  when displayed.
- **Order.** Pitch order starting at C. Within a pair, the sharp or natural name comes
  first (C♯ then D♭, F♯ then G♭, B then C♭), matching the reference. C♭ goes last, next
  to B.
- **Old sharp keys.** `A#`, `D#` and `G#` have no chip. When they're loaded they become
  `Bb`, `Eb` and `Ab`. This covers `defaultKey` and `keyOverride`, in `songsRepo` /
  `setlistsRepo` at read time, so the next save writes the new name. `E#`/`B#`/`Fb`
  aren't picked by the key-signature list either; they become `F`/`C`/`E`.

## Offsets

`keySemitoneShift(from, to)` returns the nearest move in **−5…+6** (a tritone goes up).
Both chips in a pair have the same number. This fixes today's B → C returning −11, which
drops a score almost an octave.

Where offsets appear:

| Picker | Offset from | Offset row? |
|---|---|---|
| Live Stage toolbar | song's `defaultKey` | yes |
| Setlist slot "Key for this set" | song's `defaultKey` | yes |
| Export key | song's `defaultKey` | yes |
| Library "Default key" sheet | — | **no** |

The Library sheet only changes the label for the key the chart is written in. It doesn't
transpose anything, so an offset there would be wrong. That sheet shows the key and minor
lines only.

## Chord spelling (`transposeChord`)

Transposition becomes letter-aware. Transposing from key `S` to key `T`:

1. `letters` = letter steps from `S` to `T` (D → E♭ is 1 step: D to E).
2. `semis` = `keySemitoneShift(S, T)`.
3. For each root and slash-bass note `N`: the new letter is `N`'s letter + `letters`,
   and the new pitch is `N`'s pitch + `semis`. The accidental is the difference between
   the new pitch and that letter's natural pitch.

This keeps each chord on the right letter. A ♭VII stays flat: `F` in G moved to C gives
`Bb`, not `A#`. Enharmonic respelling needs no semitone shift, so a chart in C♯ shown in
D♭ respells every chord. Today, a shift of 0 skips chords entirely, so `parseChordPro`
and `parseChordProLine` will take a from/to key pair in place of a semitone count.

**Simplifying the odd ones.** If step 3 lands on a double sharp or double flat, or on
`E#`, `B#`, `Fb` or `Cb`, respell it as the plain name for that pitch. Doubles that don't
land on a natural (`Ex` → `F#`, `Cbb` → `Bb`) use the target key's side: sharps in C and
the sharp keys, flats in the flat keys.

> **Open question: exceptions to simplifying.** Taken literally, the rule changes chords
> that belong to the key: C♭'s own I chord (`Cb` → `B`), G♭'s IV (`Cb` → `B`), C♯'s iii
> and vii (`E#m` → `Fm`, `B#°` → `C°`). The chart then disagrees with the chip you just
> picked. Two ways to handle it:
>
> - **(a) Keep the tonic only.** Keep the note when it's spelled like the key itself
>   (the `Cb` chord in C♭), and simplify everything else.
> - **(b) Keep notes that are in the key's scale.** Simplify only when the odd spelling
>   is outside the key (an `E#` borrowed into B major becomes `F`). Diatonic chords then
>   always match the chip.
>
> To be settled before the plan.

If there's no usable source key (`—`, or unparseable), chords aren't changed. That's the
same as today.

`isTransposableChord` keeps its meaning: whether the root parses as a note.

## Sheet music (`MxlScore.tsx`)

OSMD's `TransposeCalculator.transposeKey` always picks one spelling per pitch
(`keyMapping = [0,-5,2,-3,4,-1,6,1,-4,3,-2,5]` in fifths): D♭, F♯ and B. So:

- The score transposes by the new nearest-way `semis`. That's the octave fix.
- For the C♯, G♭ and C♭ chips, a small subclass of `TransposeCalculator` in `MxlScore`
  would set the key signature to +7/−6/−7 fifths. **Risk:** it's unverified whether OSMD
  spells the notes correctly past ±6 fifths. If it doesn't, the score stays on D♭/F♯/B for
  those three chips while the chart follows the chip. That gets checked during
  implementation and noted in the checklist.

The PDF export engraves through the same path, so it inherits both.

## Picker UI (`KeyChips.tsx`)

The same component everywhere: Live Stage toolbar, Library default key, setlist slot,
Export. The reference's three-line chip:

```
  -3        ← offset (omitted in Library); "0" on the current key
  D♭        ← key, bold
 B♭m        ← relative minor, small and muted
```

- The active chip is found by **pitch and spelling**. When the active value is an old
  sharp name, the migration above has already renamed it.
- The row still scrolls sideways and centers the active chip. The two iPad sizes fill
  the width (15 chips instead of 12).
- **Live Stage cost.** The floating toolbar gets taller, from about 38 px to about 60 px
  of chip. That's more chart hidden while the chrome shows. The mock-up should settle
  whether that's acceptable, or whether the toolbar drops the offset and minor lines and
  keeps them for the sheets.

## Files touched

- `src/utils/keys.ts` (new): `KEYS`, key parsing, the old-key migration.
- `src/utils/chordpro.ts`: letter-aware `transposeChord`, `keySemitoneShift` goes the
  nearest way, parse functions take from/to keys.
- `src/components/KeyChips.tsx`, `src/theme.css` (`.key-row-btn` three-line layout).
- `src/screens/live-stage/{LiveStage,MusicToolbar}.tsx`, `library/Library.tsx`,
  `setlists/SlotDetailSheet.tsx`, `export/Export.tsx`: pass `reference` / `showOffset`.
- `src/utils/exportSet.ts`: pass keys instead of semitones.
- `src/components/MxlScore.tsx`: nearest-way transpose, key-signature subclass.
- `src/data/{songsRepo,setlistsRepo}.ts`: old-key migration on read.
- `docs/progress-checklist.md`.
