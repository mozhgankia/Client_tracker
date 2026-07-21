// A clean vector silhouette of the Burj Khalifa — the tapering, stepped-
// setback tower with its central spire. Used as a decorative "Dubai real
// estate" accent on the login hero and the dashboard sidebar. Inherits color
// from `currentColor` (or an explicit `fill`) so it can be tinted gold/emerald
// by whatever wraps it.
export default function BurjKhalifa({ className, style, fill = 'currentColor' }) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 120 400"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      role="presentation"
    >
      <path
        fill={fill}
        d="M38,400 V300 H43 V215 H47.5 V150 H51 V100 H54 V60 H57 V30 H58.8 V8 H61.2
           V30 H63 V60 H66 V100 H69 V150 H72.5 V215 H77 V300 H82 V400 Z"
      />
    </svg>
  );
}
