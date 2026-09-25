export function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label?: string }) {
  return (
    <button className={"toggle" + (on ? " on" : "")} onClick={onChange} role="switch" aria-checked={on} aria-label={label}>
      <span className="knob" />
    </button>
  );
}

/** iOS segmented control. The thumb is one element that slides under the
 * selected segment rather than each segment filling in on its own. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  return (
    <div className="segmented" role="radiogroup">
      <span
        className="segmented-thumb"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? "active" : ""}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
