import { useState } from "react";
import { SideDrawer } from "../../components/Overlays";
import { useStore } from "../../state/store";
import type { Setlist } from "../../state/types";

export function AddToSetDrawer({ setlist, onClose }: { setlist: Setlist; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [q, setQ] = useState("");

  const inSetIds = new Set(
    setlist.sections.flatMap((sec) => sec.items.filter((i) => i.kind === "song").map((i) => i.songId))
  );
  const songs = state.songs.filter(
    (s) => s.title.toLowerCase().includes(q.toLowerCase()) || s.artist.toLowerCase().includes(q.toLowerCase())
  );
  const lastSection = setlist.sections[setlist.sections.length - 1];

  const add = (songId: string) => {
    dispatch({
      type: "ADD_ITEM",
      setlistId: setlist.id,
      sectionId: lastSection.id,
      item: { id: `${songId}-${Date.now()}`, kind: "song", songId },
    });
  };

  return (
    <SideDrawer title="Add to set" onClose={onClose}>
      <div style={{ padding: "10px 16px 8px" }}>
        <input className="search-bar" style={{ width: "100%" }} placeholder="Search songs" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "2px 16px 10px" }}>
        {songs.map((s) => {
          const inSet = inSetIds.has(s.id);
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{s.title}</div>
                <div className="accent-deep" style={{ fontSize: 11, marginTop: 1 }}>
                  {s.artist} · {s.defaultKey}
                </div>
              </div>
              {inSet ? (
                <span style={{ height: 28, padding: "0 8px", borderRadius: 6, background: "var(--tint)", border: "1px solid var(--acc-deep)", color: "var(--acc-deep)", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center" }}>
                  IN SET
                </span>
              ) : (
                <button
                  onClick={() => add(s.id)}
                  style={{ width: 30, height: 30, borderRadius: 6, border: "1px solid var(--acc)", color: "var(--acc)", background: "none", fontSize: 16 }}
                >
                  +
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ borderTop: "1px solid var(--line)", padding: "10px 16px 14px" }}>
        <button className="btn btn-primary btn-block" onClick={onClose}>
          Done
        </button>
      </div>
    </SideDrawer>
  );
}
