import { useState } from "react";
import { useStore } from "../../state/store";

export function QuickEditSheet({ songId, onClose }: { songId: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const song = state.songs.find((s) => s.id === songId)!;
  const [text, setText] = useState(song.chordpro);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="backdrop align-bottom" style={{ background: "transparent" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          background: "var(--surface)",
          borderRadius: "14px 14px 0 0",
          boxShadow: "0 -10px 28px rgba(29,31,32,.28)",
          display: "flex",
          flexDirection: "column",
          gap: 9,
          padding: "4px 14px 14px",
        }}
      >
        <button
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? "Collapse quick edit" : "Expand quick edit"}
          style={{
            alignSelf: "center",
            background: "none",
            border: "none",
            padding: "6px 0 2px",
            fontSize: 16,
            color: "var(--mut)",
          }}
        >
          {expanded ? "﹀" : "︿"}
        </button>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 14 }}>Quick edit</span>
          <button
            className="hdr-action"
            onClick={() => {
              dispatch({ type: "UPDATE_SONG", song: { ...song, chordpro: text } });
              onClose();
            }}
          >
            Done
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={expanded ? 14 : 5}
          style={{
            background: "var(--bg)",
            border: "1px solid var(--acc-deep)",
            borderRadius: 7,
            padding: "9px 10px",
            fontFamily: "ui-monospace, monospace",
            fontSize: 11,
            lineHeight: 1.7,
            color: "var(--fg)",
            resize: "vertical",
          }}
        />
        <div className="muted" style={{ fontSize: 11 }}>
          Edits the song in place — no separate screen, no losing your spot on stage.
        </div>
      </div>
    </div>
  );
}
