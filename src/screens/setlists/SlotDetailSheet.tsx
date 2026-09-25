import { useState } from "react";
import { Sheet } from "../../components/Overlays";
import { KeyChips } from "../../components/KeyChips";
import { useStore } from "../../state/store";
import { formatDuration } from "../../state/mockData";
import type { SetlistItem, SetlistSection, Song } from "../../state/types";

export function SlotDetailSheet({
  setlistId,
  sections,
  item,
  song,
  slotIndex,
  onClose,
}: {
  setlistId: string;
  sections: SetlistSection[];
  item: SetlistItem;
  song: Song;
  slotIndex: number;
  onClose: () => void;
}) {
  const { dispatch } = useStore();
  const [note, setNote] = useState(item.note ?? "");
  const [moveOpen, setMoveOpen] = useState(false);

  const currentSectionId = sections.find((sec) => sec.items.some((i) => i.id === item.id))?.id;

  const patch = (p: Partial<SetlistItem>) => dispatch({ type: "UPDATE_ITEM", setlistId, itemId: item.id, patch: p });

  return (
    <Sheet onClose={onClose}>
      <div>
        <div className="sheet-title">{song.title}</div>
        <div className="sheet-sub" style={{ marginTop: 2 }}>
          Slot {slotIndex + 1} · {song.artist} · library key {song.defaultKey}
        </div>
      </div>

      <div>
        <div className="list-section-header">Key for this set</div>
        <KeyChips active={item.keyOverride ?? song.defaultKey} onSelect={(k) => patch({ keyOverride: k })} />
        <div className="list-section-footer">Changes this slot only — the library copy stays in {song.defaultKey}.</div>
      </div>

      <div className="list-group">
        <div className="sheet-row">
          <span>Duration</span>
          <span className="row-detail">{formatDuration(song.durationSec)}</span>
        </div>
      </div>

      <div>
        <div className="list-section-header">Note for the band</div>
        <textarea
          className="form-textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => patch({ note })}
          rows={2}
          aria-label="Note for the band"
        />
      </div>

      <div className="sheet-group">
        <button
          className="sheet-row"
          onClick={() => {
            dispatch({ type: "DUPLICATE_ITEM", setlistId, itemId: item.id });
            onClose();
          }}
        >
          <span>Duplicate slot</span>
        </button>
        {sections.length > 1 && (
          <button className="sheet-row" onClick={() => setMoveOpen(true)}>
            <span>Move to section</span>
          </button>
        )}
      </div>
      <div className="sheet-group">
        <button
          className="sheet-row destructive"
          onClick={() => {
            dispatch({ type: "REMOVE_ITEM", setlistId, itemId: item.id });
            onClose();
          }}
        >
          <span>Remove from set</span>
        </button>
      </div>

      {moveOpen && (
        <Sheet onClose={() => setMoveOpen(false)}>
          <div className="sheet-title">Move to section</div>
          <div className="sheet-group">
          {sections.map((sec) => {
            const isCurrent = sec.id === currentSectionId;
            return (
              <button
                key={sec.id}
                className="sheet-row"
                disabled={isCurrent}
                style={isCurrent ? { opacity: 0.4 } : undefined}
                onClick={() => {
                  dispatch({ type: "MOVE_ITEM", setlistId, itemId: item.id, toSectionId: sec.id });
                  setMoveOpen(false);
                  onClose();
                }}
              >
                <span>{sec.label}</span>
                {isCurrent && <span className="muted">Current</span>}
              </button>
            );
          })}
          </div>
        </Sheet>
      )}
    </Sheet>
  );
}
