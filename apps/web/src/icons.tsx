// A small line-icon set (24px grid, 1.6 stroke, round caps), drawn for Cista.
// Icons inherit currentColor, so they follow the theme.

type P = { size?: number };
const base = (size: number) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
});

export const IconSeal = ({ size = 22 }: P) => (
  <svg {...base(size)}><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /><circle cx="12" cy="15.5" r="2.4" /></svg>
);
export const IconSign = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M4 19c3-1 4.5-4 6-7s3-5 5-5 2 2 0 4-6 4-6 6 3 1 5-1" /><path d="M4 21h16" /></svg>
);
export const IconPay = ({ size = 22 }: P) => (
  <svg {...base(size)}><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6 9.5v5M18 9.5v5" /></svg>
);
export const IconProve = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5.1 7.5-9.5V6z" /><path d="m8.8 12 2.2 2.2 4.4-4.4" /></svg>
);
export const IconBuilding = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18" /><path d="M8 8h3M8 12h3M8 16h3" /></svg>
);
export const IconPerson = ({ size = 22 }: P) => (
  <svg {...base(size)}><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20.5c1.2-3.7 4-5.6 7.5-5.6s6.3 1.9 7.5 5.6" /></svg>
);
export const IconBank = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M3 9.5 12 4l9 5.5M4.5 9.5h15M3 20.5h18" /><path d="M6 10v8M10 10v8M14 10v8M18 10v8" /></svg>
);
export const IconEyeOff = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c5 0 8.5 4.5 9.5 7-.4 1-1.2 2.3-2.4 3.5M6.6 6.7C4.6 8 3.2 10 2.5 12c1 2.5 4.5 7 9.5 7 1.7 0 3.2-.5 4.5-1.2" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
);
export const IconBriefcase = ({ size = 22 }: P) => (
  <svg {...base(size)}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18" /></svg>
);
export const IconArrowUp = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M4 18 10 12l3.5 3.5L20 9" /><path d="M15 9h5v5" /></svg>
);
export const IconRange = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M3 12h18" /><circle cx="8" cy="12" r="2.3" /><circle cx="16" cy="12" r="2.3" /><path d="M3 7v10M21 7v10" /></svg>
);
export const IconReceipt = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M6 3h12v18l-2.2-1.4L13.6 21l-1.6-1.4-1.6 1.4-2.2-1.4L6 21z" /><path d="M9 8h6M9 11.5h6M9 15h3.5" /></svg>
);
export const IconSliders = ({ size = 22 }: P) => (
  <svg {...base(size)}><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></svg>
);
export const IconKey = ({ size = 22 }: P) => (
  <svg {...base(size)}><circle cx="8" cy="15" r="4.5" /><path d="m11.3 11.7 8.2-8.2M16 7l2.5 2.5M14 9l1.8 1.8" /></svg>
);
export const IconAtom = ({ size = 22 }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="1.4" /><ellipse cx="12" cy="12" rx="9.5" ry="3.8" /><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(120 12 12)" /></svg>
);
export const IconChain = ({ size = 22 }: P) => (
  <svg {...base(size)}><rect x="2.5" y="8.5" width="9" height="7" rx="3.5" /><rect x="12.5" y="8.5" width="9" height="7" rx="3.5" /><path d="M9 12h6" /></svg>
);
export const IconArrow = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
