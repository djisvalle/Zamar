import { useState } from "react";
import { Sheet } from "../../components/Overlays";
import { KeyChips } from "../../components/KeyChips";
import { useStore } from "../../state/store";
import { formatDuration } from "../../state/mockData";
import type { SetlistItem, Song } from "../../state/types";

export function SlotDetailSheet({
  setlistId,
  item,
  song,
  slotIndex,
  onClose,
}: {
  setlistId: string;
  item: SetlistItem;
  song: Song;
  slotIndex: number;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  const [note, setNote] = useState(item.note ?? "");

  const patch = (p: Partial<SetlistItem>) => dispatch({ type: "UPDATE_ITEM", setlistId, itemId: item.id, patch: p });

  return (
    <Sheet onClose={onClose}>
      <div>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 16 }}>{song.title}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          Slot {slotIndex + 1} · {song.artist} · library key {song.defaultKey}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--mut)", marginBottom: 5 }}>KEY FOR THIS SET</div>
        <KeyChips active={item.keyOverride ?? song.defaultKey} onSelect={(k) => patch({ keyOverride: k })} />
        <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>
          Changes this slot only — the library copy stays in {song.defaultKey}.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--mut)", marginBottom: 5 }}>CAPO</div>
          <div style={{ height: 34, border: "1px solid var(--line)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 6px", fontSize: 12 }}>
            <button onClick={() => patch({ capo: Math.max(0, (item.capo ?? 0) - 1) })} style={{ border: "none", background: "none", fontSize: 14, color: "var(--acc)" }}>
              −
            </button>
            {item.capo ?? 0}
            <button onClick={() => patch({ capo: (item.capo ?? 0) + 1 })} style={{ border: "none", background: "none", fontSize: 14, color: "var(--acc)" }}>
              +
            </button>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--mut)", marginBottom: 5 }}>DURATION</div>
          <div style={{ height: 34, border: "1px solid var(--line)", borderRadius: 6, display: "flex", alignItems: "center", padding: "0 10px", fontSize: 12 }}>
            {formatDuration(song.durationSec)}
          </div>
        </div>
      </div>

      <div className="field">
        <label>Note for the band</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => patch({ note })}
          rows={2}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 1, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
        <button
          className="sheet-row"
          onClick={() => {
            dispatch({ type: "DUPLICATE_ITEM", setlistId, itemId: item.id });
            onClose();
          }}
        >
          <span>Duplicate slot</span>
        </button>
        <button
          className="sheet-row"
          style={{ color: "#8c3b3b" }}
          onClick={() => {
            dispatch({ type: "REMOVE_ITEM", setlistId, itemId: item.id });
            onClose();
          }}
        >
          <span>Remove from set</span>
        </button>
      </div>
    </Sheet>
  );
}
