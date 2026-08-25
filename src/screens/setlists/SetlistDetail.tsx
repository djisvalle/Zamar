import { useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Sheet, Dialog } from "../../components/Overlays";
import { flattenSetlist, formatDuration } from "../../utils/setlistCalc";
import { AddToSetDrawer } from "./AddToSetDrawer";
import { SlotDetailSheet } from "./SlotDetailSheet";
import { SetDetailsSheet } from "./SetDetailsSheet";
import type { SetlistItem, SetlistSection, Song } from "../../state/types";

export function SetlistDetail({ setlistId }: { setlistId: string }) {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const setlist = state.setlists.find((sl) => sl.id === setlistId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(Boolean((nav.top.params as any)?.openDetails));
  const [slot, setSlot] = useState<{ item: SetlistItem; song: Song; index: number } | null>(null);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [sectionSheetFor, setSectionSheetFor] = useState<SetlistSection | null>(null);
  const [renameSectionFor, setRenameSectionFor] = useState<SetlistSection | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteSection, setConfirmDeleteSection] = useState<SetlistSection | null>(null);

  if (!setlist) {
    return (
      <div className="screen">
        <Header title="Setlist" onBack={nav.pop} />
        <div className="empty">
          <div className="empty-title">Setlist not found</div>
        </div>
      </div>
    );
  }

  const flat = flattenSetlist(setlist, state.songs);
  const songEntries = flat.filter((e) => e.song);
  const startSong = () => {
    if (songEntries.length === 0) return;
    dispatch({ type: "STAGE_LOAD", songId: songEntries[0].song!.id, setlistId: setlist.id, setlistIndex: 0 });
    nav.reset("live-stage");
  };

  let songSlotIndex = -1;

  return (
    <div className="screen">
      <Header title={setlist.name} onBack={nav.pop} right={<button className="hdr-action" onClick={() => setMenuOpen(true)}>⋯</button>} />

      <div style={{ padding: "0 14px 9px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="muted" style={{ fontSize: 11 }}>
          {setlist.date} · {setlist.time} · {setlist.description}
        </div>
      </div>

      <div className="flex-1 hidden-scroll" style={{ padding: "0 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        {setlist.sections.map((section) => {
          return (
            <div key={section.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "4px 2px 3px" }}>
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 10, letterSpacing: "0.14em", color: "var(--mut)" }}>
                  {section.label.toUpperCase()}
                </span>
                <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
                <span
                  role="button"
                  aria-label="Section options"
                  onClick={() => setSectionSheetFor(section)}
                  className="muted"
                  style={{ fontSize: 14, padding: "0 2px" }}
                >
                  ⋯
                </span>
              </div>
              {section.items.map((item) => {
                const entry = flat.find((e) => e.item.id === item.id)!;
                if (item.kind === "note") {
                  return (
                    <div key={item.id} style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: "8px 10px", display: "flex", alignItems: "center", gap: 9 }}>
                      <span className="muted" style={{ width: 11, flex: "none", textAlign: "right", fontSize: 11 }}>
                        ▤
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5 }}>{item.label}</div>
                        <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>
                          {item.note}
                        </div>
                      </div>
                    </div>
                  );
                }
                const song = entry.song!;
                songSlotIndex += 1;
                const idx = songSlotIndex;
                return (
                  <button
                    key={item.id}
                    className="list-row"
                    style={{ alignItems: "flex-start" }}
                    onClick={() => setSlot({ item, song, index: idx })}
                  >
                    <span className="muted" style={{ fontSize: 14, lineHeight: 1, flex: "none", alignSelf: "center" }}>
                      ⋮⋮
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {song.title}
                      </div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {song.artist} · {formatDuration(song.durationSec)} · {song.tempo} BPM · {song.timeSig}
                      </div>
                      {item.note && (
                        <div className="accent-deep" style={{ fontSize: 10.5, marginTop: 3, display: "flex", gap: 5 }}>
                          <span>✎</span>
                          <span>{item.note}</span>
                        </div>
                      )}
                    </div>
                    <span className="key-chip" style={{ flex: "none", alignSelf: "center" }}>
                      {item.keyOverride ?? song.defaultKey}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}

        <button
          onClick={() => setAddOpen(true)}
          style={{ border: "1px dashed var(--acc-deep)", background: "var(--tint)", borderRadius: 8, padding: 10, textAlign: "center", fontSize: 12, color: "var(--acc-deep)", fontWeight: 600 }}
        >
          + Add song or item
        </button>
        <button
          onClick={() => setAddSectionOpen(true)}
          style={{ border: "1px dashed var(--line)", background: "none", borderRadius: 8, padding: 10, textAlign: "center", fontSize: 12, color: "var(--mut)", fontWeight: 600, marginBottom: 8 }}
        >
          + Add section
        </button>
      </div>

      <div style={{ flex: "none", padding: "10px 14px 14px", borderTop: "1px solid var(--line)", background: "var(--bg)", display: "flex", gap: 8 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={startSong} disabled={songEntries.length === 0}>
          ▶ Start Set
        </button>
        <button className="btn" style={{ width: 44, padding: 0 }} onClick={() => nav.push("export", { setlistId })}>
          ⇪
        </button>
      </div>

      {menuOpen && (
        <Sheet onClose={() => setMenuOpen(false)}>
          <button
            className="sheet-row"
            onClick={() => {
              setMenuOpen(false);
              setDetailsOpen(true);
            }}
          >
            Set details
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              setMenuOpen(false);
              nav.push("export", { setlistId });
            }}
          >
            Export set
          </button>
        </Sheet>
      )}
      {addOpen && <AddToSetDrawer setlist={setlist} onClose={() => setAddOpen(false)} />}
      {detailsOpen && <SetDetailsSheet setlist={setlist} onClose={() => setDetailsOpen(false)} />}
      {slot && (
        <SlotDetailSheet
          setlistId={setlist.id}
          item={slot.item}
          song={slot.song}
          slotIndex={slot.index}
          onClose={() => setSlot(null)}
        />
      )}
      {sectionSheetFor && (
        <Sheet onClose={() => setSectionSheetFor(null)}>
          <div className="sheet-title">{sectionSheetFor.label}</div>
          <button
            className="sheet-row"
            onClick={() => {
              const sec = sectionSheetFor;
              setSectionSheetFor(null);
              setRenameValue(sec.label);
              setRenameSectionFor(sec);
            }}
          >
            <span>Rename section</span>
          </button>
          <button
            className="sheet-row"
            style={{ color: "#8c3b3b", fontWeight: 600 }}
            onClick={() => {
              const sec = sectionSheetFor;
              setSectionSheetFor(null);
              setConfirmDeleteSection(sec);
            }}
          >
            <span>Delete section</span>
          </button>
        </Sheet>
      )}

      {renameSectionFor && (
        <Dialog>
          <div className="dialog-title">Rename section</div>
          <div className="field">
            <label>Section name</label>
            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          </div>
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button className="btn" onClick={() => setRenameSectionFor(null)}>
              Cancel
            </button>
            <button
              className={"btn btn-primary" + (!renameValue.trim() ? " is-disabled" : "")}
              disabled={!renameValue.trim()}
              onClick={() => {
                dispatch({ type: "UPDATE_SECTION", setlistId: setlist.id, sectionId: renameSectionFor.id, label: renameValue.trim() });
                setRenameSectionFor(null);
              }}
            >
              Save
            </button>
          </div>
        </Dialog>
      )}

      {confirmDeleteSection && (
        <Dialog>
          <div className="dialog-title">Delete "{confirmDeleteSection.label}"?</div>
          <div className="dialog-body">
            {confirmDeleteSection.items.length > 0
              ? `This removes ${confirmDeleteSection.items.length} item${confirmDeleteSection.items.length > 1 ? "s" : ""} from the set too. This can't be undone.`
              : "This can't be undone."}
          </div>
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button className="btn" onClick={() => setConfirmDeleteSection(null)}>
              Keep
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                dispatch({ type: "REMOVE_SECTION", setlistId: setlist.id, sectionId: confirmDeleteSection.id });
                setConfirmDeleteSection(null);
              }}
            >
              Delete
            </button>
          </div>
        </Dialog>
      )}

      {addSectionOpen && (
        <Dialog>
          <div className="dialog-title">Add section</div>
          <div className="field">
            <label>Section name</label>
            <input value={sectionName} onChange={(e) => setSectionName(e.target.value)} placeholder="e.g. Communion" autoFocus />
          </div>
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button
              className="btn"
              onClick={() => {
                setAddSectionOpen(false);
                setSectionName("");
              }}
            >
              Cancel
            </button>
            <button
              className={"btn btn-primary" + (!sectionName.trim() ? " is-disabled" : "")}
              disabled={!sectionName.trim()}
              onClick={() => {
                dispatch({ type: "ADD_SECTION", setlistId: setlist.id, label: sectionName.trim() });
                setAddSectionOpen(false);
                setSectionName("");
              }}
            >
              Add
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
