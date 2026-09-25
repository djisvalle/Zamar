import type { ReactNode } from "react";

export function Dialog({ children }: { children: ReactNode }) {
  return (
    <div className="backdrop">
      <div className="dialog">{children}</div>
    </div>
  );
}

export function Sheet({
  children,
  onClose,
  large,
  transparentBackdrop,
}: {
  children: ReactNode;
  onClose?: () => void;
  /** Nearly full height, for a list to work in. Pair with `<SheetNav>` and a
   * `.sheet-body` holding the scroll area. */
  large?: boolean;
  /** Leaves what's behind the sheet undimmed (Quick edit over the stage). */
  transparentBackdrop?: boolean;
}) {
  return (
    <div
      className="backdrop align-bottom"
      style={transparentBackdrop ? { background: "transparent" } : undefined}
      onClick={onClose}
    >
      <div className={"sheet" + (large ? " sheet--large" : "")} onClick={(e) => e.stopPropagation()}>
        <span className="sheet-grip" />
        {children}
      </div>
    </div>
  );
}

/** A sheet's navigation bar: a leading and trailing text button around a
 * centered title (Cancel / Title / Save). */
export function SheetNav({ title, left, right }: { title: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="sheet-nav">
      {left ?? <span />}
      <div className="sheet-nav-title">{title}</div>
      {right ?? <span />}
    </div>
  );
}
