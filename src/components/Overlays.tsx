import type { ReactNode } from "react";

export function Dialog({ children }: { children: ReactNode }) {
  return (
    <div className="backdrop">
      <div className="dialog">{children}</div>
    </div>
  );
}

export function Sheet({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div className="backdrop align-bottom" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <span className="sheet-grip" />
        {children}
      </div>
    </div>
  );
}

export function SideDrawer({
  title,
  onClose,
  children,
  side = "right",
}: {
  /** Omit for a drawer that supplies its own header in `children` (e.g. the
   * nav drawer's profile block) instead of the generic title+close bar. */
  title?: string;
  onClose: () => void;
  children: ReactNode;
  /** Contextual action panels (add-to-setlist, add-song) match the source
   * spec's right-side slide-in. A hamburger-triggered nav drawer opens from
   * the same side as its trigger icon (top-left ☰) — pass "left" for those. */
  side?: "left" | "right";
}) {
  return (
    <div className={`backdrop align-${side}`} onClick={onClose}>
      <div className={`drawer drawer-${side}`} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="drawer-hdr">
            <span>{title}</span>
            <button onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
