export function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button className={"toggle" + (on ? " on" : "")} onClick={onChange} role="switch" aria-checked={on}>
      <span className="knob" />
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
