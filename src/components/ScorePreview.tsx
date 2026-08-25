const STAFF_Y = [0, 8, 16, 24, 32];
const MEASURES_X = [8, 84, 160, 236, 312];

interface Note {
  x: number;
  y: number;
  flag?: boolean;
}

const SYSTEM_1: Note[] = [
  { x: 46, y: 8 }, { x: 62, y: 4, flag: true }, { x: 78, y: 12 },
  { x: 122, y: 16 }, { x: 138, y: 20, flag: true }, { x: 154, y: 12 }, { x: 170, y: 8 },
  { x: 198, y: 0 }, { x: 214, y: 8, flag: true },
  { x: 274, y: 16 }, { x: 290, y: 24, flag: true }, { x: 306, y: 16 },
];

const SYSTEM_2: Note[] = [
  { x: 46, y: 20 }, { x: 62, y: 16, flag: true }, { x: 78, y: 8 }, { x: 94, y: 4 },
  { x: 122, y: 12 }, { x: 138, y: 20, flag: true },
  { x: 198, y: 24 }, { x: 214, y: 16, flag: true }, { x: 230, y: 8 },
  { x: 274, y: 4 }, { x: 290, y: 12, flag: true },
];

function StaffSystem({ top, notes }: { top: number; notes: Note[] }) {
  return (
    <g>
      {STAFF_Y.map((y) => (
        <line key={y} x1={8} y1={top + y} x2={312} y2={top + y} stroke="var(--line)" strokeWidth={1} />
      ))}
      {MEASURES_X.map((x, i) => (
        <line
          key={x}
          x1={x}
          y1={top}
          x2={x}
          y2={top + 32}
          stroke="var(--line)"
          strokeWidth={i === 0 || i === MEASURES_X.length - 1 ? 1.6 : 1}
        />
      ))}
      <text x={14} y={top + 27} fontSize={30} fill="var(--acc)" fontFamily="Georgia, serif">
        𝄞
      </text>
      {notes.map((n, i) => {
        const cy = top + n.y;
        const stemUp = n.y >= 16;
        return (
          <g key={i}>
            <ellipse cx={n.x} cy={cy} rx={4.2} ry={3.2} fill="var(--fg)" transform={`rotate(-18 ${n.x} ${cy})`} />
            <line
              x1={stemUp ? n.x + 4 : n.x - 4}
              y1={cy}
              x2={stemUp ? n.x + 4 : n.x - 4}
              y2={stemUp ? cy - 20 : cy + 20}
              stroke="var(--fg)"
              strokeWidth={1.1}
            />
            {n.flag && (
              <path
                d={
                  stemUp
                    ? `M ${n.x + 4} ${cy - 20} q 7 3 6 11`
                    : `M ${n.x - 4} ${cy + 20} q -7 -3 -6 -11`
                }
                stroke="var(--fg)"
                strokeWidth={1.1}
                fill="none"
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

export function ScorePreview() {
  return (
    <svg viewBox="0 0 320 150" width="100%" style={{ maxWidth: 340 }} role="img" aria-label="Sample rendered score">
      <StaffSystem top={10} notes={SYSTEM_1} />
      <StaffSystem top={92} notes={SYSTEM_2} />
    </svg>
  );
}
