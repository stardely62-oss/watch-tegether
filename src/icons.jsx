/**
 * Refined icon set — soft geometry, consistent 1.5 stroke / dual-tone fills.
 * Designed for dark cinema UI.
 */

function Icon({ size = 20, children, className, filled, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

/** Soft filled mark for logo */
export function IconLogoMark(props) {
  return (
    <Icon size={28} {...props}>
      <defs>
        <linearGradient id="logoGrad" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.75" />
        </linearGradient>
      </defs>
      {/* ticket / frame */}
      <rect
        x="3.5"
        y="5"
        width="17"
        height="14"
        rx="3"
        fill="url(#logoGrad)"
        fillOpacity="0.15"
        stroke="url(#logoGrad)"
        strokeWidth="1.5"
      />
      <path
        d="M8 5v14M16 5v14"
        stroke="url(#logoGrad)"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="12" cy="12" r="2.2" fill="url(#logoGrad)" />
    </Icon>
  );
}

export function IconFilm(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" fill="currentColor" fillOpacity="0.12" {...stroke} />
      <path d="M7 4v16M17 4v16" {...stroke} />
      <path d="M3 9h4M3 15h4M17 9h4M17 15h4" {...stroke} />
    </Icon>
  );
}

export function IconTv(props) {
  return (
    <Icon {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2.5" fill="currentColor" fillOpacity="0.12" {...stroke} />
      <path d="M8 21h8M12 18v3" {...stroke} />
      <path d="M9 3l3 3 3-3" {...stroke} />
    </Icon>
  );
}

export function IconSparkles(props) {
  return (
    <Icon {...props}>
      <path
        d="M12 3.5l1.35 3.9L17.5 9l-4.15 1.35L12 14.5l-1.35-4.15L6.5 9l4.15-1.6L12 3.5z"
        fill="currentColor"
        fillOpacity="0.2"
        {...stroke}
      />
      <path
        d="M18.5 13.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z"
        fill="currentColor"
        fillOpacity="0.35"
        {...stroke}
      />
    </Icon>
  );
}

export function IconSearch(props) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" fill="currentColor" fillOpacity="0.08" {...stroke} />
      <path d="M16.5 16.5L20 20" {...stroke} />
    </Icon>
  );
}

export function IconPlus(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity="0.1" {...stroke} />
      <path d="M12 8v8M8 12h8" {...stroke} />
    </Icon>
  );
}

export function IconHeart({ filled, ...props }) {
  return (
    <Icon {...props}>
      <path
        d="M12 20s-7-4.4-7-9.2A3.9 3.9 0 0112 7.1a3.9 3.9 0 017 3.7C19 15.6 12 20 12 20z"
        fill={filled ? 'currentColor' : 'currentColor'}
        fillOpacity={filled ? 1 : 0.1}
        {...stroke}
      />
    </Icon>
  );
}

export function IconStar({ filled, ...props }) {
  return (
    <Icon {...props}>
      <path
        d="M12 3.5l2.2 4.7 5.2.7-3.8 3.5.99 5.15L12 15.4l-4.59 2.55.99-5.15-3.8-3.5 5.2-.7L12 3.5z"
        fill={filled ? 'currentColor' : 'currentColor'}
        fillOpacity={filled ? 1 : 0.1}
        {...stroke}
      />
    </Icon>
  );
}

export function IconX(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity="0.08" {...stroke} />
      <path d="M9 9l6 6M15 9l-6 6" {...stroke} />
    </Icon>
  );
}

export function IconLogOut(props) {
  return (
    <Icon {...props}>
      <path d="M10 7V6a2 2 0 012-2h6a2 2 0 012 2v12a2 2 0 01-2 2h-6a2 2 0 01-2-2v-1" {...stroke} />
      <path d="M4 12h10M11 8l4 4-4 4" {...stroke} />
    </Icon>
  );
}

export function IconTrash(props) {
  return (
    <Icon {...props}>
      <path d="M5 7h14" {...stroke} />
      <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" {...stroke} />
      <path
        d="M7.5 7l.7 12a1.5 1.5 0 001.5 1.4h4.6a1.5 1.5 0 001.5-1.4l.7-12"
        fill="currentColor"
        fillOpacity="0.1"
        {...stroke}
      />
      <path d="M10 11v5M14 11v5" {...stroke} />
    </Icon>
  );
}

export function IconUsers(props) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3" fill="currentColor" fillOpacity="0.15" {...stroke} />
      <path d="M3.5 18.5a5.5 5.5 0 0111 0" {...stroke} />
      <circle cx="17" cy="9" r="2.2" fill="currentColor" fillOpacity="0.1" {...stroke} />
      <path d="M17 13.5c2.4.3 4 1.8 4.5 5" {...stroke} />
    </Icon>
  );
}

export function IconCheck(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity="0.12" {...stroke} />
      <path d="M8 12.5l2.5 2.5L16.5 9" {...stroke} />
    </Icon>
  );
}

export function IconClapper(props) {
  return (
    <Icon {...props}>
      <path
        d="M4 10h16v9a2 2 0 01-2 2H6a2 2 0 01-2-2v-9z"
        fill="currentColor"
        fillOpacity="0.12"
        {...stroke}
      />
      <path d="M4 10l2.2-5.5h3.2L7 10M10.5 4.5h3.2L11.5 10M17 4.5h3L17.8 10" {...stroke} />
      <path d="M4 13.5h16" {...stroke} opacity="0.5" />
    </Icon>
  );
}

// Keep alias used by App
export function IconPopcorn(props) {
  return <IconLogoMark {...props} />;
}
