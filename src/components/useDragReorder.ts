import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

/** Where a dragged row would land: `index` is its position within `group`
 * counted with the dragged row already taken out. */
export interface DropTarget {
  group: string;
  index: number;
}

/**
 * Press-and-drag reordering from a grip handle, built on pointer events so
 * it works with touch on iOS and Android web views (HTML5 drag-and-drop
 * doesn't fire from touch there).
 *
 * Rows opt in with `rowProps(id, group)`; an empty group can still be
 * dropped into by rendering a placeholder with `emptyGroupProps(group)`.
 * The grip gets `handleProps(id)`. On release, `onDrop(id, target)` is
 * called if the row actually moved.
 */
export function useDragReorder(onDrop: (id: string, target: DropTarget) => void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const start = useRef<{ y: number; group: string; index: number } | null>(null);
  const moved = useRef(false);

  const candidates = (id: string) => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-drag-group]"));
    const perGroup = new Map<string, number>();
    return rows
      .filter((el) => el.dataset.dragId !== id)
      .map((el) => {
        const group = el.dataset.dragGroup!;
        const empty = el.dataset.dragEmpty === "true";
        const index = perGroup.get(group) ?? 0;
        if (!empty) perGroup.set(group, index + 1);
        const r = el.getBoundingClientRect();
        return { group, index, mid: r.top + r.height / 2, bottom: r.bottom, empty };
      });
  };

  const locate = (id: string, y: number): DropTarget | null => {
    const rows = candidates(id);
    for (let k = 0; k < rows.length; k++) {
      const row = rows[k];
      if (y < row.mid) return { group: row.group, index: row.index };
      // Over the lower half of a group's last row: drop at the end of that
      // group rather than at the top of the next one.
      const lastInGroup = rows[k + 1]?.group !== row.group;
      if (lastInGroup && y < row.bottom) return { group: row.group, index: row.empty ? 0 : row.index + 1 };
    }
    const last = rows[rows.length - 1];
    if (!last) return null;
    return { group: last.group, index: last.empty ? 0 : last.index + 1 };
  };

  const handleProps = (id: string) => ({
    style: { touchAction: "none" as const, userSelect: "none" as const, WebkitUserSelect: "none" as const, cursor: "grab" },
    onClick: (e: ReactMouseEvent) => e.stopPropagation(),
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      e.stopPropagation();
      const row = e.currentTarget.closest<HTMLElement>("[data-drag-id]");
      if (!row) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const group = row.dataset.dragGroup!;
      const siblings = Array.from(document.querySelectorAll<HTMLElement>("[data-drag-id]")).filter((el) => el.dataset.dragGroup === group);
      start.current = { y: e.clientY, group, index: Math.max(0, siblings.indexOf(row)) };
      moved.current = false;
      setDragId(id);
      setTarget({ group: start.current.group, index: start.current.index });
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (!start.current || dragId !== id) return;
      const dy = e.clientY - start.current.y;
      if (Math.abs(dy) > 4) moved.current = true;
      setTarget(locate(id, e.clientY));
    },
    onPointerUp: () => {
      const from = start.current;
      if (from && target && moved.current && (target.group !== from.group || target.index !== from.index)) {
        onDrop(id, target);
      }
      start.current = null;
      setDragId(null);
      setTarget(null);
    },
    onPointerCancel: () => {
      start.current = null;
      setDragId(null);
      setTarget(null);
    },
  });

  /** `index` is the row's position in its group as rendered. The row that
   * would end up just below the dragged one gets `drop-before`; the group's
   * last row gets `drop-after` when the drop lands at the end. */
  const rowProps = (id: string, group: string, index: number, groupSize: number) => {
    let cls = "drag-row";
    if (dragId === id) cls += " is-dragging";
    else if (dragId && target && target.group === group && moved.current) {
      const from = start.current;
      const sameGroup = from?.group === group;
      const pos = sameGroup && from && index > from.index ? index - 1 : index;
      const size = sameGroup ? groupSize - 1 : groupSize;
      if (pos === target.index) cls += " drop-before";
      else if (target.index === size && pos === size - 1) cls += " drop-after";
    }
    return {
      "data-drag-id": id,
      "data-drag-group": group,
      className: cls,
    };
  };

  /** Placeholder row for an empty group, so something can be dropped into it. */
  const emptyGroupProps = (group: string) => ({
    "data-drag-group": group,
    "data-drag-empty": "true",
    className: dragId && target?.group === group && moved.current ? "drag-row drop-before" : undefined,
  });

  return { dragId, target, handleProps, rowProps, emptyGroupProps };
}
