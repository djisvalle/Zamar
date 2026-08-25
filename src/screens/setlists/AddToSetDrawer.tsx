import { useMemo, useRef, useState } from "react";
import { SideDrawer } from "../../components/Overlays";
import { useStore } from "../../state/store";
import type { Setlist, Song } from "../../state/types";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
type SortBy = "title" | "artist";

export function AddToSetDrawer({ setlist, onClose }: { setlist: Setlist; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("title");
  const [orderMenuOpen, setOrderMenuOpen] = useState(false);
  const letterRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const inSetIds = new Set(
    setlist.sections.flatMap((sec) => sec.items.filter((i) => i.kind === "song").map((i) => i.songId))
  );
  const lastSection = setlist.sections[setlist.sections.length - 1];

  const filtered = state.songs.filter(
    (s) => s.title.toLowerCase().includes(q.toLowerCase()) || s.artist.toLowerCase().includes(q.toLowerCase())
  );

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

  const add = (songId: string) => {
    dispatch({
      type: "ADD_ITEM",
      setlistId: setlist.id,
      sectionId: lastSection.id,
      item: { id: `${songId}-${Date.now()}`, kind: "song", songId },
    });
  };

  const scrollToLetter = (letter: string) => {
    letterRefs.current[letter]?.scrollIntoView({ block: "start" });
  };

  return (
    <SideDrawer title="Add to set" onClose={onClose}>
      <div style={{ padding: "11px 16px 8px", borderBottom: "1px solid var(--line)" }}>
        <input
          className="search-bar"
          style={{ width: "100%" }}
          placeholder="Search songs"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div style={{ position: "relative", borderBottom: "1px solid var(--line)" }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOrderMenuOpen((o) => !o);
          }}
          style={{ background: "none", border: "none", padding: "8px 16px", fontSize: 12, color: "var(--mut)" }}
        >
          Order By: <span className="accent-deep" style={{ fontWeight: 700 }}>{sortBy === "title" ? "Title" : "Artist"}</span>{" "}
          <span style={{ fontSize: 9 }}>▾</span>
        </button>
        {orderMenuOpen && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 12,
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

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        <div
          style={{ height: "100%", overflowY: "auto", padding: "10px 30px 10px 16px" }}
          onClick={() => orderMenuOpen && setOrderMenuOpen(false)}
        >
          {groups.map(([letter, list], i) => (
            <div
              key={letter}
              ref={(el) => (letterRefs.current[letter] = el)}
              style={i > 0 ? { borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 10 } : undefined}
            >
              <div className="list-header">{letter}</div>
              <div style={{ display: "flex", flexDirection: "column", marginTop: 2 }}>
                {list.map((s) => {
                  const inSet = inSetIds.has(s.id);
                  return (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{s.title}</div>
                        <div className="accent-deep" style={{ fontSize: 11, marginTop: 1 }}>
                          {s.artist} · {s.defaultKey}
                        </div>
                      </div>
                      {inSet && (
                        <span
                          style={{
                            height: 28,
                            padding: "0 8px",
                            borderRadius: 6,
                            background: "var(--tint)",
                            border: "1px solid var(--acc-deep)",
                            color: "var(--acc-deep)",
                            fontSize: 9,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            flex: "none",
                          }}
                        >
                          IN SET
                        </span>
                      )}
                      <button
                        title={inSet ? "Add again (reprise)" : "Add to set"}
                        onClick={() => add(s.id)}
                        style={{ width: 30, height: 30, flex: "none", borderRadius: 6, border: "1px solid var(--acc)", color: "var(--acc)", background: "none", fontSize: 16 }}
                      >
                        +
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {groups.length === 0 && <div className="muted" style={{ fontSize: 12, padding: "12px 0" }}>No songs match.</div>}
        </div>

        <div
          style={{
            position: "absolute",
            top: 6,
            bottom: 6,
            right: 2,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            alignItems: "center",
            width: 14,
          }}
        >
          {ALPHABET.map((letter) => {
            const has = groups.some(([l]) => l === letter);
            return (
              <span
                key={letter}
                role={has ? "button" : undefined}
                aria-label={has ? `Jump to ${letter}` : undefined}
                onClick={() => has && scrollToLetter(letter)}
                style={{
                  fontSize: 8.5,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: has ? "var(--acc)" : "var(--line)",
                  cursor: has ? "pointer" : "default",
                }}
              >
                {letter}
              </span>
            );
          })}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", padding: "10px 16px 14px" }}>
        <button className="btn btn-primary btn-block" onClick={onClose}>
          Done
        </button>
      </div>
    </SideDrawer>
  );
}
