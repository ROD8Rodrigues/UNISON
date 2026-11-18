export function Logo({ size = 30, withWord = false }: { size?: number; withWord?: boolean }) {
  return (
    <span className="logo" aria-label="UNISON">
      <img
        className="logo-mark"
        src="/logo-mark.png"
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      {withWord && <span className="logo-word">UNISON</span>}
    </span>
  );
}
