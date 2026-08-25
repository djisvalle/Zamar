import { useState } from "react";
import { Sheet } from "../../components/Overlays";
import { useStore } from "../../state/store";
import type { Setlist } from "../../state/types";

export function SetDetailsSheet({ setlist, onClose }: { setlist: Setlist; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(setlist.name);
  const [date, setDate] = useState(setlist.date);
  const [time, setTime] = useState(setlist.time);
  const [description, setDescription] = useState(setlist.description);

  const duplicate = state.setlists.some((sl) => sl.id !== setlist.id && sl.name.trim() === name.trim() && name.trim() !== "");

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Set details</div>
      <div className={"field" + (duplicate ? " invalid" : "")}>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {duplicate && <div className="field-error">A setlist with this name already exists.</div>}
      <div style={{ display: "flex", gap: 9 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Date</label>
          <input value={date} onChange={(e) => setDate(e.target.value)} placeholder="Sun, Aug 23 2026" />
        </div>
        <div className="field" style={{ width: "38%" }}>
          <label>Time</label>
          <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="9:00 AM" />
        </div>
      </div>
      <div className="field">
        <label>Description</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="btn-row">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className={"btn btn-primary" + (duplicate || !name.trim() ? " is-disabled" : "")}
          disabled={duplicate || !name.trim()}
          onClick={() => {
            dispatch({ type: "UPDATE_SETLIST_META", setlistId: setlist.id, patch: { name, date, time, description } });
            onClose();
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}
