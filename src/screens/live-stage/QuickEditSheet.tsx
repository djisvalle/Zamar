import { useState } from "react";
import { useStore } from "../../state/store";
import { Sheet, SheetNav } from "../../components/Overlays";
import { readChartMeta } from "../../utils/chordpro";
import { canonicalKey } from "../../utils/keys";

export function QuickEditSheet({ songId, onClose }: { songId: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const song = state.songs.find((s) => s.id === songId)!;
  const [text, setText] = useState(song.chordpro);
  const [expanded, setExpanded] = useState(false);

  const save = () => {
    // Metadata directives in the chart update the song's own fields, the
    // same as in Add/Edit Song.
    const meta = readChartMeta(text);
    const next = { ...song, chordpro: text };
    if (meta.title) next.title = meta.title;
    if (meta.artist) next.artist = meta.artist;
    if (meta.key && /^[A-G](#|b)?$/.test(meta.key)) next.defaultKey = canonicalKey(meta.key);
    if (meta.tempo && Number(meta.tempo)) next.tempo = Number(meta.tempo);
    if (meta.timeSig) next.timeSig = meta.timeSig;
    dispatch({ type: "UPDATE_SONG", song: next });
    onClose();
  };

  // The stage stays visible and undimmed behind the sheet, so the edit can
  // be checked against the chart without losing your spot.
  return (
    <Sheet transparentBackdrop>
      <SheetNav
        title="Quick edit"
        left={
          <button
            className="hdr-action"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        }
        right={
          <button className="hdr-action hdr-action--done" onClick={save}>
            Done
          </button>
        }
      />
      <textarea
        className="form-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={expanded ? 14 : 5}
        style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, lineHeight: 1.7 }}
      />
      <div className="sheet-sub" style={{ marginTop: -4, textAlign: "left", padding: "0 16px" }}>
        Edits the song in place — no separate screen, no losing your spot on stage.
      </div>
    </Sheet>
  );
}
