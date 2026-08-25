export function StatusBar() {
  return (
    <div className="status-bar">
      <span>9:41</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
          <rect x="0" y="7" width="3" height="5" rx="0.5" fill="currentColor" />
          <rect x="5" y="5" width="3" height="7" rx="0.5" fill="currentColor" />
          <rect x="10" y="3" width="3" height="9" rx="0.5" fill="currentColor" />
          <rect x="15" y="0" width="3" height="12" rx="0.5" fill="currentColor" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M1 4.5C4.5 1 11.5 1 15 4.5" />
          <path d="M3.5 7.2C6 4.8 10 4.8 12.5 7.2" />
          <path d="M6.2 9.7C7.4 8.6 8.6 8.6 9.8 9.7" />
          <circle cx="8" cy="11.3" r="0.8" fill="currentColor" stroke="none" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect x="0.75" y="0.75" width="20.5" height="10.5" rx="2.5" stroke="currentColor" strokeWidth="1" />
          <rect x="2.25" y="2.25" width="14" height="7.5" rx="1" fill="currentColor" />
          <rect x="22.5" y="4" width="1.75" height="4" rx="0.8" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}
