# Enharmonic key picker

## Context

Every key and transposed chord is spelled with sharps today. `CHROMATIC` in
`src/utils/chordpro.ts` is a sharps-only scale, and it drives both `transposeChord` (G up
three semitones gives `A#`, never `Bb`) and the `KeyChips` row. Picking the fourth chip
stores `A#` as the song's key. A song typed in as `Bb` (Add/Edit Song, or a `{key: Bb}`
directive) never shows an active chip, because `KeyChips` matches the label text
(`k === active`) and no chip says `Bb`.

The replacement follows a reference key picker (shared in chat). It lists every key that
has a key signature, with the relative minor under each key, and the chip you tap
decides the spelling. Mock-up: `https://claude.ai/artifact/7dkdGipf2xCUhqaASi5rNA`.

Decisions made in chat:

- **15 chips** (the key-signature keys), in pitch order. C♯/D♭, F♯/G♭ and B/C♭ each get
  two chips.
- **Offsets are hidden by default.** Settings has a toggle that shows them.
- **Offsets and score moves go the nearest way**, so a MusicXML score moves by at most
  half an octave.
- **Chord spelling keeps the right letter, with the odd ones simplified.** The default
  keeps an odd spelling only when it names the key itself (rule a). Settings has a
  "Strict spelling" toggle that keeps every note in the key's scale (rule b).
- **The relative minor is a label only.** Songs still have a major key.

## Goals

- You pick the key's spelling, and every chord on the chart follows it.
- Keys are stored exactly as picked (`Db` stays `Db`).
- A song whose key is `Bb` highlights the B♭ chip.
- Sheet music moves no more than 6 semitones for a key change, and its notes are spelled
  to match the new key signature.

## Out of scope

- Minor keys as song keys. The `KEY_RE` in Add/Edit Song still takes roots only.
- Capo, which is cut. See `docs/progress-checklist.md`.
- Re-keying MusicXML *exports*. They still go out as imported.
- Respelling the tuner's note names.

## The key list (`src/utils/keys.ts`, new)

C, C♯, D♭, D, E♭, E, F, F♯, G♭, G, A♭, A, B♭, B, C♭, each with its relative minor
(A m, A♯m, B♭m, B m, C m, C♯m, D m, D♯m, E♭m, E m, F m, F♯m, G m, G♯m, A♭m).

- Stored and parsed values keep ASCII `#`/`b`, as they do now. Labels use `♯`/`♭` only
  when displayed.
- **Order.** Pitch order starting at C. Within a pair, the sharp or natural name comes
  first (C♯ then D♭, F♯ then G♭, B then C♭), matching the reference. C♭ goes last, next
  to B.
- **Old sharp keys.** `A#`, `D#` and `G#` have no chip. They become `Bb`, `Eb` and
  `Ab` when state is loaded (`hydrateState`, both `defaultKey` and `keyOverride`), so the
  next save writes the new name. `E#`, `B#` and `Fb` become `F`, `C` and `E`. Add/Edit
  Song saves its key through the same mapping.

## Settings (Settings → Keys)

| Toggle | Default | Effect |
|---|---|---|
| Show key offsets | off | Adds the semitone offset above each chip in the Live Stage toolbar, the setlist slot sheet and Export. Never in the Library "Default key" sheet, which only relabels the key the chart is written in and doesn't transpose. |
| Strict spelling | off | Switches chord spelling from rule (a) to rule (b), below. |

Stored as two new `settings` columns (`showKeyOffsets`, `strictSpelling`, DB v9).

## Offsets

`keySemitoneShift(from, to)` returns the nearest move in **−5…+6** (a tritone goes up).
Both chips in a pair share the number. This fixes today's B → C returning −11, which
drops a score almost an octave. Export keeps its existing Up/Down control for scores.

## Chord spelling (`transposeChord`)

Transposition becomes letter-aware. Transposing from key `S` to key `T`:

1. `letters` = letter steps from `S` to `T` (D → E♭ is 1 step: D to E).
2. `semis` = the pitch distance from `S` to `T`.
3. For each root and slash-bass note `N`: the new letter is `N`'s letter + `letters`,
   and the new pitch is `N`'s pitch + `semis`. The accidental is the difference between
   the new pitch and that letter's natural pitch.

This keeps each chord on the right letter. A ♭VII stays flat: `F` in G moved to C gives
`Bb`, not `A#`. Respelling needs no pitch change, so a chart in C♯ shown in D♭ respells
every chord. The parse functions now take a `{ from, to, strict }` key change instead of
a semitone count. Nothing changes when `from` and `to` are the same, or when either one
isn't a key (`—`).

**Simplifying.** An *odd* result is a double sharp or flat, or `E#`, `B#`, `Fb` or `Cb`.
It's respelled as the plain name for that pitch: the natural if there is one, else the
target key's side (flats in F, B♭, E♭, A♭, D♭, G♭, C♭; sharps otherwise). Exceptions:

- **Rule (a), the default:** keep the note when it's spelled like the key itself (the
  `Cb` chord in C♭).
- **Rule (b), Strict spelling:** keep the note when it's in the key's major scale (C♯'s
  `E#m` and `B#°`, G♭'s `Cb`). Only odd spellings outside the key are simplified.

`isTransposableChord` keeps its meaning: whether the root parses as a note.

## Sheet music (`MxlScore.tsx`, PDF export)

OSMD's `TransposeCalculator` can't do this. It always picks D♭, F♯ and B for the key
signature, and spells notes as naturals where possible, then with sharps or flats by the
key's side. In F♯ that already writes `F` with a natural sign where `E#` belongs. A small
calculator of our own (`src/utils/scoreTranspose.ts`) replaces it:

- **Key signature.** When the transposed key has the chip's pitch, the signature uses the
  chip's spelling (C♯ = 7 sharps, G♭ = 6 flats, C♭ = 7 flats). Other key signatures in
  the score use the nearest-way mapping.
- **Notes.** Same letter-aware rule as the chart. Scores always use rule (b), whatever
  the setting, because a note outside the key signature's spelling would print with a
  stray natural or accidental against the signature.
- **Limit.** OSMD skips transposing when the move is 0 semitones. So picking D♭ for a
  score written in C♯ leaves the score as written; only the chart respells.

The PDF export engraves through the same calculator.

## Picker UI (`KeyChips.tsx`)

The same component everywhere: Live Stage toolbar, Library default key, setlist slot,
Export. Each chip is:

```
  -3        ← offset, only with "Show key offsets" on; "0" on the song's key
  D♭        ← key, bold
 B♭m        ← relative minor, small and muted
```

- The active chip matches the stored key exactly. Old sharp names were already renamed
  on load.
- The row still scrolls sideways and centers the active chip. The two iPad sizes fill
  the width.

## Files touched

- `src/utils/keys.ts` (new): the key list, note parsing, spelling rules, old-key mapping.
- `src/utils/scoreTranspose.ts` (new): the OSMD transpose calculator.
- `src/utils/chordpro.ts`: letter-aware `transposeChord`, nearest-way
  `keySemitoneShift`, parse functions take a key change.
- `src/components/{KeyChips,ChordChart,MxlScore}.tsx`, `src/theme.css`.
- `src/screens/live-stage/{LiveStage,MusicToolbar}.tsx`, `setlists/SlotDetailSheet.tsx`,
  `export/Export.tsx`, `add-edit-song/AddEditSong.tsx`, `settings/Settings.tsx`.
- `src/utils/exportSet.ts`: charts spell from keys, scores use the new calculator.
- `src/state/{types,store}.ts`, `src/data/{db,settingsRepo}.ts`: the two settings.
- `docs/progress-checklist.md`.
