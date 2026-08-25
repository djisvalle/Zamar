import { useMemo, useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Sheet, Dialog } from "../../components/Overlays";
import { KeyChips } from "../../components/KeyChips";
import type { Song } from "../../state/types";

type Filter = "all" | "favourites" | "recent";
type SortBy = "title" | "artist";

export function Library() {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("title");
  const [orderMenuOpen, setOrderMenuOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetFor, setSheetFor] = useState<Song | null>(null);
  const [keySheetFor, setKeySheetFor] = useState<Song | null>(null);
  const [importSheetOpen, setImportSheetOpen] = useState(false);
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

  const groups = useMemo(() => {
    const byLetter = new Map<string, Song[]>();
    [...filtered]
      .sort((a, b) => (sortBy === "title" ? a.title.localeCompare(b.title) : a.artist.localeCompare(b.artist)))
      .forEach((s) => {
        const letter = (sortBy === "title" ? s.title : s.artist)[0]?.toUpperCase() ?? "#";
        if (!byLetter.has(letter)) byLetter.set(letter, []);
        byLetter.get(letter)!.push(s);
      });
    return [...byLetter.entries()];
  }, [filtered, sortBy]);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openSong = (id: string) => {
    dispatch({ type: "STAGE_LOAD", songId: id });
    nav.reset("live-stage");
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  return (
    <div className="screen">
      <Header
        title={selectMode ? `${selected.size} selected` : "Library"}
        onBack={nav.pop}
        right={
          selectMode ? (
            <button className="hdr-action" onClick={exitSelectMode}>
              Cancel
            </button>
          ) : (
            <button className="hdr-action" onClick={() => setSelectMode(true)} disabled={state.songs.length === 0}>
              Select
            </button>
          )
        }
      />
      <div style={{ padding: "10px 14px 8px" }}>
        <div className={"search-bar" + (query ? " active" : "")}>
          <span>⌕</span>
          <input placeholder="Search songs" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button className="muted" style={{ background: "none", border: "none" }} onClick={() => setQuery("")}>
              ×
            </button>
          )}
        </div>
      </div>

      {!query && (
        <div style={{ display: "flex", gap: 6, padding: "0 14px 8px" }}>
          {(["all", "favourites", "recent"] as Filter[]).map((f) => (
            <button key={f} className={"chip" + (filter === f ? " active" : "")} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "favourites" ? "Favourites" : "Recent"}
            </button>
          ))}
        </div>
      )}
      {query && (
        <div className="muted" style={{ fontSize: 11, padding: "0 14px 8px" }}>
          {filtered.length} of {state.songs.length} · titles, artists and lyrics
        </div>
      )}

      {state.songs.length === 0 ? (
        <div className="empty">
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
        <div className="empty">
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
          <div style={{ position: "relative", borderBottom: "1px solid var(--line)", margin: "0 14px" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOrderMenuOpen((o) => !o);
              }}
              style={{ background: "none", border: "none", padding: "0 0 8px", fontSize: 12, color: "var(--mut)" }}
            >
              Order By: <span className="accent-deep" style={{ fontWeight: 700 }}>{sortBy === "title" ? "Title" : "Artist"}</span>{" "}
              <span style={{ fontSize: 9 }}>▾</span>
            </button>
            {orderMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  boxShadow: "0 4px 14px rgba(29, 31, 32, 0.2)",
                  zIndex: 10,
                  overflow: "hidden",
                }}
              >
                {(["title", "artist"] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setSortBy(opt);
                      setOrderMenuOpen(false);
                    }}
                    style={{
                      display: "block",
                      width: 120,
                      textAlign: "left",
                      padding: "9px 14px",
                      background: sortBy === opt ? "var(--tint)" : "none",
                      border: "none",
                      fontSize: 12,
                      fontWeight: sortBy === opt ? 700 : 500,
                      color: sortBy === opt ? "var(--acc-deep)" : "var(--fg)",
                    }}
                  >
                    {opt === "title" ? "Title" : "Artist"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div
            className="flex-1 hidden-scroll"
            style={{ padding: "0 14px", display: "flex", flexDirection: "column", gap: 6 }}
            onClick={() => orderMenuOpen && setOrderMenuOpen(false)}
          >
          {groups.map(([letter, list]) => (
            <div key={letter}>
              <div className="list-header">{letter}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                {list.map((s) => {
                  const isSel = selected.has(s.id);
                  return (
                    <button
                      key={s.id}
                      className="list-row"
                      style={selectMode && isSel ? { background: "var(--tint)", borderColor: "var(--acc-deep)" } : undefined}
                      onClick={() => (selectMode ? toggleSelected(s.id) : openSong(s.id))}
                      onContextMenu={(e) => { e.preventDefault(); if (!selectMode) setSheetFor(s); }}
                    >
                      {selectMode ? (
                        <span
                          style={{
                            width: 17,
                            height: 17,
                            borderRadius: 4,
                            flex: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            background: isSel ? "var(--acc)" : "none",
                            color: isSel ? "var(--onacc)" : "none",
                            border: isSel ? "none" : "1px solid var(--line)",
                          }}
                        >
                          {isSel ? "✓" : ""}
                        </span>
                      ) : (
                        <span
                          className="accent-deep"
                          style={{ fontSize: 13, flex: "none", opacity: s.favourite ? 1 : 0.25 }}
                        >
                          ★
                        </span>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 500 }}>{s.title}</span>
                          <span className="key-chip">{s.defaultKey}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {s.artist}
                        </div>
                      </div>
                      {!selectMode && (
                        <span
                          role="button"
                          aria-label="More"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSheetFor(s);
                          }}
                          className="muted"
                          style={{ fontSize: 15, padding: "0 2px" }}
                        >
                          ⋯
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          </div>
        </>
      )}

      {!selectMode && (
        <div className="fab-stack" style={{ bottom: 18 }}>
          <button className="fab" onClick={() => nav.push("add-edit-song")} aria-label="Add a song">
            +
          </button>
          <button className="fab-mini" onClick={() => setImportSheetOpen(true)} aria-label="Import a chart">
            ⇩
          </button>
        </div>
      )}

      {selectMode && (
        <div style={{ background: "var(--surface)", borderTop: "1px solid var(--line)", padding: "11px 14px", display: "flex", justifyContent: "space-between", fontSize: 12 }}>
          <button className="accent-deep" style={{ background: "none", border: "none", fontWeight: 600 }} disabled={selected.size === 0}>
            Add to setlist
          </button>
          <button className="accent-deep" style={{ background: "none", border: "none" }} disabled={selected.size === 0}>
            Export
          </button>
          <button
            style={{ background: "none", border: "none", color: "#8c3b3b", fontWeight: 600 }}
            disabled={selected.size === 0}
            onClick={() => setConfirmDelete([...selected])}
          >
            Delete
          </button>
        </div>
      )}

      {sheetFor && (
        <Sheet onClose={() => setSheetFor(null)}>
          <div className="sheet-title">{sheetFor.title}</div>
          <div className="muted" style={{ fontSize: 10, marginTop: -6 }}>
            {sheetFor.artist} · {sheetFor.defaultKey}
          </div>
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
            <span className="accent-deep">★</span>
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
            style={{ color: "#8c3b3b", fontWeight: 600 }}
            onClick={() => {
              setConfirmDelete([sheetFor.id]);
              setSheetFor(null);
            }}
          >
            <span>Delete song</span>
          </button>
        </Sheet>
      )}

      {importSheetOpen && (
        <Sheet onClose={() => setImportSheetOpen(false)}>
          <div className="sheet-title">Import a chart</div>
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
        </Sheet>
      )}

      {existingPickerOpen && (
        <Sheet onClose={() => setExistingPickerOpen(false)}>
          <div className="sheet-title">Attach to which song?</div>
          <input
            className="search-bar"
            style={{ width: "100%" }}
            placeholder="Search songs"
            value={existingQuery}
            onChange={(e) => setExistingQuery(e.target.value)}
            autoFocus
          />
          <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column" }}>
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
        </Sheet>
      )}

      {keySheetFor && (
        <Sheet onClose={() => setKeySheetFor(null)}>
          <div className="sheet-title">{keySheetFor.title}</div>
          <div className="muted" style={{ fontSize: 10, marginTop: -6 }}>
            Default key · applies wherever this song doesn't have a setlist key override
          </div>
          <KeyChips
            active={keySheetFor.defaultKey}
            onSelect={(k) => {
              dispatch({ type: "UPDATE_SONG", song: { ...keySheetFor, defaultKey: k } });
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
