import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** The 34pt title at the top of a root screen's scroll area. Pair it with
 * `<Header large>`, which fades in the small title once this has scrolled
 * under the bar. */
export function LargeTitle({ children }: { children: ReactNode }) {
  return <h1 className="large-title">{children}</h1>;
}

/** One inset grouped section: optional header, a rounded group of rows,
 * optional footer. */
export function Section({
  header,
  headerAccessory,
  footer,
  footerError,
  tight,
  children,
}: {
  header?: ReactNode;
  /** A small control at the trailing end of the header (e.g. a "more" button). */
  headerAccessory?: ReactNode;
  footer?: ReactNode;
  /** Renders the footer in system red, for validation messages. */
  footerError?: boolean;
  /** Less space above, for a section that follows a title or search field. */
  tight?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={"list-section" + (tight ? " list-section--tight" : "")}>
      {(header || headerAccessory) && (
        <div className="list-section-header">
          <span>{header}</span>
          {headerAccessory}
        </div>
      )}
      <div className="list-group">{children}</div>
      {footer && <div className={"list-section-footer" + (footerError ? " error" : "")}>{footer}</div>}
    </section>
  );
}

export function Chevron() {
  return (
    <span className="row-chevron" aria-hidden>
      <Icon name="chevron-right" size={18} strokeWidth={2.4} />
    </span>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="search-field">
      <Icon name="search" size={17} strokeWidth={2.2} />
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        aria-label={placeholder}
      />
      {value && (
        <button type="button" className="search-field-clear" onClick={() => onChange("")} aria-label="Clear search">
          <Icon name="close" size={10} strokeWidth={3.2} />
        </button>
      )}
    </label>
  );
}
