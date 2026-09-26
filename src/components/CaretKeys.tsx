import { useEffect, useRef, type RefObject } from "react";
import { Icon } from "./Icon";

const HOLD_DELAY = 400;
const REPEAT_EVERY = 60;

/**
 * ◀ ▶ buttons that move a textarea's caret one character, repeating while
 * held, for placing the caret precisely on a touch screen where dragging it
 * with a finger is fiddly (as OnSong's editor bar does).
 *
 * Pressing a button doesn't take focus from the textarea, so the keyboard
 * stays up. With a selection, ◀/▶ collapse it to its start/end first, as the
 * arrow keys do.
 */
export function CaretKeys({ target }: { target: RefObject<HTMLTextAreaElement | null> }) {
  const timer = useRef<number | undefined>(undefined);

  const stop = () => {
    window.clearTimeout(timer.current);
    window.clearInterval(timer.current);
    timer.current = undefined;
  };
  useEffect(() => stop, []);

  const step = (dir: -1 | 1) => {
    const el = target.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end, value } = el;
    const pos = start !== end ? (dir < 0 ? start : end) : Math.max(0, Math.min(value.length, start + dir));
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.setSelectionRange(pos, pos);
  };

  const keyProps = (dir: -1 | 1) => ({
    type: "button" as const,
    className: "caret-key",
    onPointerDown: (e: React.PointerEvent) => {
      // Keep focus (and the keyboard) on the textarea.
      e.preventDefault();
      stop();
      step(dir);
      timer.current = window.setTimeout(() => {
        timer.current = window.setInterval(() => step(dir), REPEAT_EVERY);
      }, HOLD_DELAY);
    },
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    // Keyboard activation (Enter/Space) arrives as a click with no pointer.
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) step(dir);
    },
  });

  return (
    <div className="caret-keys">
      <button {...keyProps(-1)} aria-label="Move cursor left">
        <Icon name="chevron-left" size={20} strokeWidth={2.4} />
      </button>
      <button {...keyProps(1)} aria-label="Move cursor right">
        <Icon name="chevron-right" size={20} strokeWidth={2.4} />
      </button>
    </div>
  );
}
