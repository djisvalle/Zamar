import { useState } from "react";
import { useStore } from "../../state/store";
import { Sheet, SheetNav } from "../../components/Overlays";

export function QuickEditSheet({ songId, onClose }: { songId: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const song = state.songs.find((s) => s.id === songId)!;
  const [text, setText] = useState(song.chordpro);
  const [expanded, setExpanded] = useState(false);

  const save = () => {
    dispatch({ type: "UPDATE_SONG", song: { ...song, chordpro: text } });
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
