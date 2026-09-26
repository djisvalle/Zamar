import { useMemo, useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Sheet, Dialog } from "../../components/Overlays";
import { KeyChips } from "../../components/KeyChips";
import { Icon } from "../../components/Icon";
import { LargeTitle, Section, SearchField } from "../../components/List";
import { OrderByMenu, groupSongs, type SortBy } from "../../components/SongPickerSheet";
import type { Song } from "../../state/types";
import { writeChartMeta } from "../../utils/chordpro";

type Filter = "all" | "favourites" | "recent";

export function Library() {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("title");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetFor, setSheetFor] = useState<Song | null>(null);
  const [keySheetFor, setKeySheetFor] = useState<Song | null>(null);
  const [importSheetOpen, setImportSheetOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [existingPickerOpen, setExistingPickerOpen] = useState(false);
  const [existingQuery, setExistingQuery] = useState("");
  const [attachMethodFor, setAttachMethodFor] = useState<Song | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);

  const filtered = useMemo(() => {
    let list = state.songs;
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));
    } else if (filter === "favourites") {
      list = list.filter((s) => s.favourite);
    } else if (filter === "recent") {
      list = list.slice(-5);
    }
    return list;
  }, [state.songs, query, filter]);

  const groups = useMemo(() => groupSongs(filtered, sortBy), [filtered, sortBy]);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openSong = (id: string) => {
    dispatch({ type: "STAGE_LOAD", songId: id });
    nav.resetTab("live-stage");
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  return (
    <div className="screen screen--grouped">
      <Header
        title={selectMode ? `${selected.size} selected` : "Library"}
        large={!selectMode}
        right={
          selectMode ? (
            <button className="hdr-action" onClick={exitSelectMode}>
              Cancel
            </button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button className="hdr-action" onClick={() => setSelectMode(true)} disabled={state.songs.length === 0}>
                Select
              </button>
              <button className="hdr-btn" onClick={() => setAddMenuOpen(true)} aria-label="Add or import a song">
                <Icon name="plus" size={20} strokeWidth={2.2} />
              </button>
            </div>
          )
        }
      />
      <div className={"ios-list" + (selectMode ? "" : " scroll-under-tabs")}>
        <LargeTitle>Library</LargeTitle>
        <SearchField value={query} onChange={setQuery} placeholder="Search songs" />

        {!query && (
          <div className="chip-row" style={{ marginTop: 12 }}>
            {(["all", "favourites", "recent"] as Filter[]).map((f) => (
              <button key={f} className={"chip" + (filter === f ? " active" : "")} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f === "favourites" ? "Favourites" : "Recent"}
              </button>
            ))}
          </div>
        )}
        {query && (
          <div className="list-section-footer" style={{ paddingTop: 10 }}>
            {filtered.length} of {state.songs.length} · titles, artists and lyrics
          </div>
        )}

        {state.songs.length === 0 ? (
          <div className="empty" style={{ paddingTop: 48 }}>
            <div className="empty-title">No songs yet</div>
            <div className="empty-body">Type a chart, paste ChordPro, or convert a PDF or photo of a sheet.</div>
            <div className="btn-row" style={{ width: "100%" }}>
              <button className="btn btn-primary" onClick={() => nav.push("add-edit-song")}>
                Add a song
              </button>
              <button className="btn" onClick={() => setImportSheetOpen(true)}>
                Import a chart
              </button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty" style={{ paddingTop: 48 }}>
            <div className="empty-title">No match for "{query}"</div>
            <div className="empty-body">Searched titles, artists and lyrics across {state.songs.length} songs.</div>
            <div className="btn-row" style={{ width: "100%" }}>
              <button className="btn" onClick={() => setQuery("")}>
                Clear
              </button>
              <button className="btn btn-primary" onClick={() => nav.push("add-edit-song", { prefillTitle: query })}>
                Add it
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 4px 0" }}>
              <OrderByMenu value={sortBy} onChange={setSortBy} />
            </div>
            {groups.map(([letter, list], gi) => (
              <Section key={letter} header={letter} tight={gi === 0}>
                {list.map((s) => {
                  const isSel = selected.has(s.id);
                  return (
                    <button
                      key={s.id}
                      className="sheet-row sheet-row--lead"
                      aria-pressed={selectMode ? isSel : undefined}
                      onClick={() => (selectMode ? toggleSelected(s.id) : openSong(s.id))}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (!selectMode) setSheetFor(s);
                      }}
                    >
                      {selectMode ? (
                        <span className={"select-circle" + (isSel ? " on" : "")}>
                          {isSel && <Icon name="check" size={14} strokeWidth={3} />}
                        </span>
                      ) : (
                        <span className="row-lead" style={{ opacity: s.favourite ? 1 : 0.25 }}>
                          <Icon name="star" size={17} strokeWidth={1.8} filled={s.favourite} />
                        </span>
                      )}
                      <div className="row-main">
                        <div className="row-title">
                          <span>{s.title}</span>
                          <span className="key-chip">{s.defaultKey}</span>
                        </div>
                        <div className="row-sub">{s.artist}</div>
                      </div>
                      {!selectMode && (
                        <span
                          role="button"
                          aria-label={`More for ${s.title}`}
                          className="row-more"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSheetFor(s);
                          }}
                        >
                          <Icon name="more" size={20} strokeWidth={2} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </Section>
            ))}
          </>
        )}
      </div>

      {selectMode && (
        <div className="toolbar">
          <button className="toolbar-btn" disabled={selected.size === 0}>
            Add to setlist
          </button>
          <button className="toolbar-btn" disabled={selected.size === 0}>
            Export
          </button>
          <button className="toolbar-btn destructive" disabled={selected.size === 0} onClick={() => setConfirmDelete([...selected])}>
            Delete
          </button>
        </div>
      )}

      {sheetFor && (
        <Sheet onClose={() => setSheetFor(null)}>
          <div className="sheet-title">{sheetFor.title}</div>
          <div className="sheet-sub">
            {sheetFor.artist} · {sheetFor.defaultKey}
          </div>
          <div className="sheet-group">
          <button className="sheet-row" onClick={() => { openSong(sheetFor.id); setSheetFor(null); }}>
            <span>Load on stage</span>
          </button>
          <button className="sheet-row" onClick={() => setSheetFor(null)}>
            <span>Add to setlist…</span>
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              const song = sheetFor;
              setSheetFor(null);
              setKeySheetFor(song);
            }}
          >
            <span>Change default key</span>
            <span className="accent-deep">{sheetFor.defaultKey}</span>
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              dispatch({ type: "TOGGLE_FAVOURITE", songId: sheetFor.id });
              setSheetFor(null);
            }}
          >
            <span>{sheetFor.favourite ? "Remove from favourites" : "Add to favourites"}</span>
            <span className="accent-deep" style={{ display: "flex" }}>
              <Icon name="star" size={14} strokeWidth={1.8} filled={sheetFor.favourite} />
            </span>
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              const id = sheetFor.id;
              setSheetFor(null);
              nav.push("add-edit-song", { songId: id });
            }}
          >
            <span>Edit chart</span>
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              dispatch({ type: "DUPLICATE_SONG", songId: sheetFor.id });
              setSheetFor(null);
            }}
          >
            <span>Duplicate song</span>
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              const id = sheetFor.id;
              setSheetFor(null);
              nav.push("export", { songId: id });
            }}
          >
            <span>Export…</span>
          </button>
          </div>
          <div className="sheet-group">
          <button
            className="sheet-row destructive"
            onClick={() => {
              setConfirmDelete([sheetFor.id]);
              setSheetFor(null);
            }}
          >
            <span>Delete song</span>
          </button>
          </div>
        </Sheet>
      )}

      {addMenuOpen && (
        <Sheet onClose={() => setAddMenuOpen(false)}>
          <div className="sheet-title">Add to Library</div>
          <div className="sheet-group">
          <button
            className="sheet-row"
            onClick={() => {
              setAddMenuOpen(false);
              nav.push("add-edit-song");
            }}
          >
            <span>New song</span>
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              setAddMenuOpen(false);
              setImportSheetOpen(true);
            }}
          >
            <span>Import a chart</span>
          </button>
          </div>
        </Sheet>
      )}

      {importSheetOpen && (
        <Sheet onClose={() => setImportSheetOpen(false)}>
          <div className="sheet-title">Import a chart</div>
          <div className="sheet-group">
          <button
            className="sheet-row"
            onClick={() => {
              setImportSheetOpen(false);
              nav.push("import-song", { method: "pdf" });
            }}
          >
            <span>Import a PDF</span>
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              setImportSheetOpen(false);
              nav.push("import-song", { method: "photo" });
            }}
          >
            <span>Import a photo</span>
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              setImportSheetOpen(false);
              nav.push("import-song", { method: "musicxml" });
            }}
          >
            <span>Import MusicXML</span>
          </button>
          <button
            className="sheet-row"
            disabled={state.songs.length === 0}
            onClick={() => {
              setImportSheetOpen(false);
              setExistingQuery("");
              setExistingPickerOpen(true);
            }}
          >
            <span>Attach to an existing song…</span>
          </button>
          </div>
        </Sheet>
      )}

      {existingPickerOpen && (
        <Sheet onClose={() => setExistingPickerOpen(false)}>
          <div className="sheet-title">Attach to which song?</div>
          <SearchField value={existingQuery} onChange={setExistingQuery} placeholder="Search songs" autoFocus />
          <div className="sheet-group" style={{ maxHeight: 320, overflowY: "auto" }}>
            {state.songs
              .filter(
                (s) => s.title.toLowerCase().includes(existingQuery.toLowerCase()) || s.artist.toLowerCase().includes(existingQuery.toLowerCase())
              )
              .map((s) => (
                <button
                  key={s.id}
                  className="sheet-row"
                  onClick={() => {
                    setExistingPickerOpen(false);
                    setAttachMethodFor(s);
                  }}
                >
                  <span>{s.title}</span>
                  <span className="muted">{s.artist}</span>
                </button>
              ))}
          </div>
        </Sheet>
      )}

      {attachMethodFor && (
        <Sheet onClose={() => setAttachMethodFor(null)}>
          <div className="sheet-title">Attach to {attachMethodFor.title}</div>
          <div className="sheet-group">
          <button
            className="sheet-row"
            onClick={() => {
              const songId = attachMethodFor.id;
              setAttachMethodFor(null);
              nav.push("import-song", { method: "pdf", target: { kind: "existing", songId } });
            }}
          >
            <span>Attach a PDF</span>
          </button>
          <button
            className="sheet-row"
            onClick={() => {
              const songId = attachMethodFor.id;
              setAttachMethodFor(null);
              nav.push("import-song", { method: "photo", target: { kind: "existing", songId } });
            }}
          >
            <span>Attach a photo</span>
          </button>
          </div>
        </Sheet>
      )}

      {keySheetFor && (
        <Sheet onClose={() => setKeySheetFor(null)}>
          <div className="sheet-title">{keySheetFor.title}</div>
          <div className="sheet-sub">Default key · applies wherever this song doesn't have a setlist key override</div>
          <KeyChips
            active={keySheetFor.defaultKey}
            onSelect={(k) => {
              dispatch({ type: "UPDATE_SONG", song: { ...keySheetFor, defaultKey: k, chordpro: writeChartMeta(keySheetFor.chordpro, "key", k) } });
              setKeySheetFor(null);
            }}
          />
        </Sheet>
      )}

      {confirmDelete && (
        <Dialog>
          <div className="dialog-title">Delete {confirmDelete.length} song{confirmDelete.length > 1 ? "s" : ""}?</div>
          <div className="dialog-body">This removes it from any setlist slots too. This can't be undone.</div>
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button className="btn" onClick={() => setConfirmDelete(null)}>
              Keep
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                const deletedIds = new Set(confirmDelete);
                for (const setlist of state.setlists) {
                  for (const section of setlist.sections) {
                    for (const item of section.items) {
                      if (item.kind === "song" && item.songId && deletedIds.has(item.songId)) {
                        dispatch({ type: "REMOVE_ITEM", setlistId: setlist.id, itemId: item.id });
                      }
                    }
                  }
                }
                dispatch({ type: "DELETE_SONGS", ids: confirmDelete });
                setConfirmDelete(null);
                if (selectMode) exitSelectMode();
              }}
            >
              Delete
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
