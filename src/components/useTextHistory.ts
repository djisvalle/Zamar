import { useReducer, useRef } from "react";

const LIMIT = 200;
/** Edits in the same group this close together undo as one step, so undo
 * takes back a burst of typing rather than a single letter. */
const GROUP_WINDOW_MS = 1000;

/**
 * Undo/redo history for one piece of text whose edits come from several
 * places (typing, inserted snippets, fields that rewrite it), which the
 * browser's own textarea undo can't follow once React sets the value.
 *
 * Call `record(before, group?)` just before each change. Changes sharing a
 * `group` within a second merge into one step; ungrouped ones are always
 * their own step. `undo(current)`/`redo(current)` return the text to apply,
 * or undefined when there's nothing to go back or forward to.
 */
export function useTextHistory() {
  const h = useRef({ past: [] as string[], future: [] as string[], group: undefined as string | undefined, at: 0 });
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const record = (before: string, group?: string) => {
    const s = h.current;
    const now = Date.now();
    const merge = group !== undefined && group === s.group && now - s.at < GROUP_WINDOW_MS && s.past.length > 0;
    if (!merge) {
      s.past.push(before);
      if (s.past.length > LIMIT) s.past.shift();
    }
    s.group = group;
    s.at = now;
    s.future = [];
    rerender();
  };

  const step = (from: string[], to: string[], current: string) => {
    const text = from.pop();
    if (text === undefined) return undefined;
    to.push(current);
    h.current.group = undefined;
    rerender();
    return text;
  };

  return {
    record,
    undo: (current: string) => step(h.current.past, h.current.future, current),
    redo: (current: string) => step(h.current.future, h.current.past, current),
    canUndo: h.current.past.length > 0,
    canRedo: h.current.future.length > 0,
  };
}

/** Where to leave the caret after swapping `from` for `to`: the end of the
 * part that changed. */
export function caretAfterChange(from: string, to: string) {
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) start++;
  let end = 0;
  while (end < from.length - start && end < to.length - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++;
  return to.length - end;
}
