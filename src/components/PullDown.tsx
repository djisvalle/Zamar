import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

const MENU_WIDTH = 240;
const ROW_H = 44;

/** iOS pull-down menu: tapping the trigger opens a glass menu of options
 * under it, the current one checked. The menu is portaled to the device
 * (list groups clip their rounded corners, sheets scroll) and flips above
 * the trigger when there isn't room below. */
export function PullDown<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  children,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  /** Optional caption at the top of the menu ("Sort By"). */
  label?: string;
  className?: string;
  /** The trigger's contents. */
  children: ReactNode;
  ariaLabel?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ device: HTMLElement; style: React.CSSProperties } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const device = trigger?.closest<HTMLElement>(".device");
    if (!trigger || !device) return;
    const t = trigger.getBoundingClientRect();
    const d = device.getBoundingClientRect();
    const originX = d.left + device.clientLeft;
    const originY = d.top + device.clientTop;
    const menuH = options.length * ROW_H + 12 + (label ? 28 : 0);
    // Align the menu's trailing edge with the trigger's, unless the trigger
    // sits on the leading half of the screen.
    const alignLeft = t.left + t.width / 2 < d.left + d.width / 2;
    let left = alignLeft ? t.left - originX : t.right - originX - MENU_WIDTH;
    left = Math.max(8, Math.min(left, device.clientWidth - MENU_WIDTH - 8));
    const below = t.bottom - originY + 6;
    const fitsBelow = below + menuH < device.clientHeight - 16;
    const top = fitsBelow ? below : Math.max(8, t.top - originY - 6 - menuH);
    setPos({
      device,
      style: {
        left,
        top,
        ["--menu-origin" as string]: `${alignLeft ? "left" : "right"} ${fitsBelow ? "top" : "bottom"}`,
      },
    });
  }, [open, options.length, label]);

  const close = () => {
    setOpen(false);
    setPos(null);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {children}
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div
              className="menu-dismiss"
              onClick={(e) => {
                e.stopPropagation();
                close();
              }}
            />
            <div className="glass ios-menu ios-menu--floating" role="menu" style={pos.style} onClick={(e) => e.stopPropagation()}>
              {label && <div className="ios-menu-label">{label}</div>}
              {options.map((o) => (
                <button
                  key={o.value}
                  role="menuitemradio"
                  aria-checked={o.value === value}
                  onClick={() => {
                    onChange(o.value);
                    close();
                  }}
                >
                  {o.label}
                  {o.value === value && (
                    <span className="ios-menu-check">
                      <Icon name="check" size={17} strokeWidth={2.2} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>,
          pos.device
        )}
    </>
  );
}
