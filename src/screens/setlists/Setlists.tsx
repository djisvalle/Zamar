import { useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Dialog } from "../../components/Overlays";
import { Icon } from "../../components/Icon";
import { setlistStatus } from "../../utils/setlistCalc";
import type { Setlist } from "../../state/types";

type Tab = "upcoming" | "past" | "template";

export function Setlists() {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const list = state.setlists.filter((sl) => setlistStatus(sl) === tab);

  const duplicateNewName = state.setlists.some((sl) => sl.name.trim() === newName.trim() && newName.trim() !== "");

  const openCreateDialog = () => {
    setNewName("New setlist");
    setCreating(true);
  };

  // Nothing is written to the store until this confirms — unlike the old behaviour, which
  // dispatched ADD_SETLIST on the "+" tap itself with no cancel/discard path. Mirrors
  // Add/Edit Song, which also only commits on an explicit Save.
  const confirmCreate = () => {
    const name = newName.trim();
    if (!name || duplicateNewName) return;
    const id = `set-${Date.now()}`;
    const setlist: Setlist = {
      id,
      name,
      date: "",
      time: "",
      description: "",
      status: "upcoming",
      sections: [{ id: `${id}-sec`, label: "Set", items: [] }],
    };
    dispatch({ type: "ADD_SETLIST", setlist });
    setCreating(false);
    nav.push("setlist-detail", { setlistId: id, openDetails: true });
  };

  return (
    <div className="screen">
      <Header title="Setlists" large onBack={nav.pop} right={<span className="hdr-action" style={{ display: "flex" }}><Icon name="more" size={16} /></span>} />
      <div style={{ padding: "2px 14px 8px", display: "flex", gap: 6 }}>
        {(["upcoming", "past", "template"] as Tab[]).map((t) => (
          <button key={t} className={"chip" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>
            {t === "upcoming" ? "Upcoming" : t === "past" ? "Past" : "Templates"}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="empty">
          <div className="empty-title">No setlists yet</div>
          <div className="empty-body">
            Build one from your {state.songs.length} songs. Order, keys and timings can change any time.
          </div>
          <button className="btn btn-primary btn-block" onClick={openCreateDialog}>
            Build a set
          </button>
        </div>
      ) : (
        <div className="flex-1 hidden-scroll" style={{ padding: "4px 14px", paddingBottom: 90, display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map((sl, i) => {
            const isActive = state.stage.setlistId === sl.id;
            return (
              <button
                key={sl.id}
                className="card"
                style={{
                  textAlign: "left",
                  cursor: "pointer",
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 9,
                  ...(isActive ? { border: "1.5px solid rgba(140, 59, 59, 0.45)" } : {}),
                }}
                onClick={() => nav.push("setlist-detail", { setlistId: sl.id })}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 16 }}>{sl.name}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                      {sl.date} · {sl.description}
                    </div>
                  </div>
                  {isActive && (
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "5px 9px 5px 7px",
                        borderRadius: 8,
                        background: "var(--live)",
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                      }}
                    >
                      <span style={{ width: 5, height: 5, borderRadius: 99, background: "currentColor" }} />
                      LIVE
                    </span>
                  )}
                </div>
                {i === 0 && (
                  <span
                    className={"btn " + (isActive ? "btn-danger" : "btn-primary")}
                    style={{ marginTop: 1 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isActive) {
                        dispatch({ type: "STAGE_EXIT" });
                        return;
                      }
                      const ids = sl.sections.flatMap((sec) => sec.items.filter((it) => it.kind === "song").map((it) => it.songId!));
                      if (ids.length) {
                        dispatch({ type: "STAGE_LOAD", songId: ids[0], setlistId: sl.id, setlistIndex: 0 });
                        nav.reset("live-stage");
                      }
                    }}
                  >
                    <Icon name={isActive ? "stop" : "play"} size={12} />
                    {isActive ? "Stop Set" : "Start Set"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <button className="fab" style={{ position: "absolute", right: 14, bottom: 18 }} onClick={openCreateDialog} aria-label="New setlist">
        <Icon name="plus" size={24} strokeWidth={2} />
      </button>

      {creating && (
        <Dialog>
          <div className="dialog-title">New setlist</div>
          <div className={"field" + (duplicateNewName ? " invalid" : "")}>
            <label>Name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </div>
          {duplicateNewName && <div className="field-error">A setlist with this name already exists.</div>}
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button className="btn" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              className={"btn btn-primary" + (!newName.trim() || duplicateNewName ? " is-disabled" : "")}
              disabled={!newName.trim() || duplicateNewName}
              onClick={confirmCreate}
            >
              Create
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
