import { useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import { Sheet, SheetNav } from "./Overlays";
import { SearchField } from "./List";
import { PullDown } from "./PullDown";
import { Icon } from "./Icon";
import type { Song } from "../state/types";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export type SortBy = "title" | "artist";
export const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
];

/** Groups songs A-Z by the first letter of the sort field. */
export function groupSongs(songs: Song[], sortBy: SortBy): [string, Song[]][] {
  const byLetter = new Map<string, Song[]>();
  [...songs]
    .sort((a, b) => (sortBy === "title" ? a.title.localeCompare(b.title) : a.artist.localeCompare(b.artist)))
    .forEach((s) => {
      const letter = (sortBy === "title" ? s.title : s.artist)[0]?.toUpperCase() ?? "#";
      if (!byLetter.has(letter)) byLetter.set(letter, []);
      byLetter.get(letter)!.push(s);
    });
  return [...byLetter.entries()];
}

/** "Order by Title ⌃⌄": a tint pull-down that picks the list's sort field. */
export function OrderByMenu({ value, onChange }: { value: SortBy; onChange: (v: SortBy) => void }) {
  return (
    <PullDown value={value} options={SORT_OPTIONS} onChange={onChange} label="Order By" className="menu-picker menu-picker--tint">
      <span>Order by {value === "title" ? "Title" : "Artist"}</span>
      <Icon name="chevron-up-down" size={14} strokeWidth={2.2} />
    </PullDown>
  );
}

/** Large sheet for picking songs from the library: search, sort, A-Z
 * sections with a section index, and per-row actions supplied by the
 * caller ("Add to set" and Live Stage's "Add to Setlist"). */
export function SongPickerSheet({
  title,
  onClose,
  trailing,
  subtitle,
}: {
  title: string;
  onClose: () => void;
  /** The row's action buttons (and any badge) at its trailing end. */
  trailing: (song: Song) => ReactNode;
  /** Optional line under the search field, e.g. which setlist songs go to. */
  subtitle?: ReactNode;
}) {
  const { state } = useStore();
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("title");
  const letterRefs = useRef<Record<string, HTMLElement | null>>({});

  const groups = useMemo(() => {
    const needle = q.toLowerCase();
    const filtered = state.songs.filter((s) => s.title.toLowerCase().includes(needle) || s.artist.toLowerCase().includes(needle));
    return groupSongs(filtered, sortBy);
  }, [state.songs, q, sortBy]);

  return (
    <Sheet large onClose={onClose}>
      <SheetNav
        title={title}
        right={
          <button className="hdr-action hdr-action--done" onClick={onClose}>
            Done
          </button>
        }
      />
      <div style={{ padding: "4px 16px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
        <SearchField value={q} onChange={setQ} placeholder="Search songs" />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 28 }}>
          <span className="muted" style={{ fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {subtitle}
          </span>
          <OrderByMenu value={sortBy} onChange={setSortBy} />
        </div>
      </div>
      <div className="sheet-body">
        <div className="sheet-scroll sheet-scroll--indexed">
          {groups.map(([letter, list], i) => (
            <section
              key={letter}
              ref={(el) => (letterRefs.current[letter] = el)}
              className={"list-section" + (i === 0 ? " list-section--tight" : "")}
              style={i === 0 ? { marginTop: 0 } : { marginTop: 16 }}
            >
              <div className="list-section-header">{letter}</div>
              <div className="list-group">
                {list.map((s) => (
                  <div key={s.id} className="sheet-row">
                    <div className="row-main">
                      <div className="row-title">
                        <span>{s.title}</span>
                      </div>
                      <div className="row-sub">
                        {s.artist} · {s.defaultKey}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>{trailing(s)}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {groups.length === 0 && (
            <div className="muted" style={{ fontSize: 15, padding: "24px 0", textAlign: "center" }}>
              No songs match.
            </div>
          )}
        </div>
        <div className="index-rail" aria-label="Section index">
          {ALPHABET.map((letter) => {
            const has = groups.some(([l]) => l === letter);
            return (
              <button
                key={letter}
                disabled={!has}
                aria-label={`Jump to ${letter}`}
                onClick={() => letterRefs.current[letter]?.scrollIntoView({ block: "start" })}
              >
                {letter}
              </button>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}
