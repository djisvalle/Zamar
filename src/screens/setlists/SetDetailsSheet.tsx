import { useState } from "react";
import { Sheet, SheetNav } from "../../components/Overlays";
import { useStore } from "../../state/store";
import type { Setlist } from "../../state/types";

// Matches what setlistCalc.ts's startClockLabel can actually parse
// unambiguously (an hour with no AM/PM suffix is otherwise silently
// treated as AM). Empty is also valid — "no time set yet".
const TIME_PATTERN = /^\d{1,2}:\d{2}\s*(AM|PM)$/i;

export function SetDetailsSheet({ setlist, onClose }: { setlist: Setlist; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(setlist.name);
  const [date, setDate] = useState(setlist.date);
  const [time, setTime] = useState(setlist.time);
  const [description, setDescription] = useState(setlist.description);

  const duplicate = state.setlists.some((sl) => sl.id !== setlist.id && sl.name.trim() === name.trim() && name.trim() !== "");
  const timeInvalid = time.trim() !== "" && !TIME_PATTERN.test(time.trim());

  const canSave = !duplicate && Boolean(name.trim()) && !timeInvalid;

  return (
    <Sheet onClose={onClose}>
      <SheetNav
        title="Set details"
        left={
          <button className="hdr-action" onClick={onClose}>
            Cancel
          </button>
        }
        right={
          <button
            className="hdr-action hdr-action--done"
            disabled={!canSave}
            onClick={() => {
              dispatch({ type: "UPDATE_SETLIST_META", setlistId: setlist.id, patch: { name, date, time, description } });
              onClose();
            }}
          >
            Save
          </button>
        }
      />
      <div>
        <div className="list-group">
          <div className="form-row">
            <div className={"form-cell" + (duplicate ? " invalid" : "")}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" />
            </div>
          </div>
        </div>
        {duplicate && <div className="list-section-footer error">A setlist with this name already exists.</div>}
      </div>
      <div>
        <div className="list-group">
          <div className="form-row">
            <label className="form-cell form-cell--value">
              <span className="form-label">Date</span>
              <input value={date} onChange={(e) => setDate(e.target.value)} placeholder="Sun, Aug 23 2026" />
            </label>
          </div>
          <div className="form-row">
            <label className={"form-cell form-cell--value" + (timeInvalid ? " invalid" : "")}>
              <span className="form-label">Time</span>
              <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="9:00 AM" />
            </label>
          </div>
        </div>
        {timeInvalid && <div className="list-section-footer error">Enter a time like "9:00 AM", or leave it blank.</div>}
      </div>
      <div className="list-group">
        <div className="form-row">
          <div className="form-cell">
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" aria-label="Description" />
          </div>
        </div>
      </div>
    </Sheet>
  );
}
