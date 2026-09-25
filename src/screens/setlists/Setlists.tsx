import { useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Dialog } from "../../components/Overlays";
import { Icon } from "../../components/Icon";
import { LargeTitle, Section, Chevron } from "../../components/List";
import { Segmented } from "../../components/Toggle";
import { setlistStatus, setlistSongCount } from "../../utils/setlistCalc";
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

  const startOrStop = (sl: Setlist, isActive: boolean) => {
    if (isActive) {
      dispatch({ type: "STAGE_EXIT" });
      return;
    }
    const ids = sl.sections.flatMap((sec) => sec.items.filter((it) => it.kind === "song").map((it) => it.songId!));
    if (ids.length) {
      dispatch({ type: "STAGE_LOAD", songId: ids[0], setlistId: sl.id, setlistIndex: 0 });
      nav.resetTab("live-stage");
    }
  };

  const row = (sl: Setlist) => {
    const isActive = state.stage.setlistId === sl.id;
    return (
      <button key={sl.id} className="sheet-row" onClick={() => nav.push("setlist-detail", { setlistId: sl.id })}>
        <div className="row-main">
          <div className="row-title">
            <span style={{ fontWeight: 600 }}>{sl.name}</span>
            {isActive && <span className="badge-live">LIVE</span>}
          </div>
          <div className="row-sub">{[sl.date, sl.description].filter(Boolean).join(" · ") || `${setlistSongCount(sl)} songs`}</div>
        </div>
        <Chevron />
      </button>
    );
  };

  const [first, ...rest] = list;
  const firstActive = first ? state.stage.setlistId === first.id : false;

  return (
    <div className="screen screen--grouped">
      <Header
        title="Setlists"
        large
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button className="hdr-btn" onClick={openCreateDialog} aria-label="New setlist">
              <Icon name="plus" size={20} strokeWidth={2.2} />
            </button>
            <span className="hdr-action" style={{ display: "flex" }}><Icon name="more" size={16} /></span>
          </div>
        }
      />
      <div className="ios-list scroll-under-tabs">
        <LargeTitle>Setlists</LargeTitle>
        <Segmented<Tab>
          options={[
            { value: "upcoming", label: "Upcoming" },
            { value: "past", label: "Past" },
            { value: "template", label: "Templates" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {list.length === 0 ? (
          <div className="empty" style={{ paddingTop: 48 }}>
            <div className="empty-title">No setlists yet</div>
            <div className="empty-body">
              Build one from your {state.songs.length} songs. Order, keys and timings can change any time.
            </div>
            <button className="btn btn-primary btn-block" onClick={openCreateDialog}>
              Build a set
            </button>
          </div>
        ) : (
          <>
            <Section tight>
              {row(first)}
              <button className={"sheet-row action" + (firstActive ? " destructive" : "")} onClick={() => startOrStop(first, firstActive)}>
                <span style={{ display: "flex" }}>
                  <Icon name={firstActive ? "stop" : "play"} size={15} />
                </span>
                <span>{firstActive ? "Stop Set" : "Start Set"}</span>
              </button>
            </Section>
            {rest.length > 0 && <Section>{rest.map(row)}</Section>}
          </>
        )}
      </div>

      {creating && (
        <Dialog>
          <div className="dialog-title">New setlist</div>
          <input
            className={"alert-input" + (duplicateNewName ? " invalid" : "")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            aria-label="Name"
            autoFocus
          />
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
