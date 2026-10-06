// Inline stand-ins for the @tabler/icons-react glyphs the ported blocks use (same 24px grid and
// 2px stroke as Tabler), so artifacts do not bundle an icon package.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconArrowUpRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="M17 7l-10 10" />
    <path d="M8 7l9 0l0 9" />
  </Icon>
);

export const IconArrowDownRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 7l10 10" />
    <path d="M17 8l0 9l-9 0" />
  </Icon>
);

export const IconMinus = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12l14 0" />
  </Icon>
);

export const IconArrowUp = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5l0 14" />
    <path d="M18 11l-6 -6" />
    <path d="M6 11l6 -6" />
  </Icon>
);

export const IconArrowDown = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5l0 14" />
    <path d="M18 13l-6 6" />
    <path d="M6 13l6 6" />
  </Icon>
);

export const IconSelector = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 9l4 -4l4 4" />
    <path d="M16 15l-4 4l-4 -4" />
  </Icon>
);

export const IconCheck = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12l5 5l10 -10" />
  </Icon>
);

export const IconSearch = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
    <path d="M21 21l-6 -6" />
  </Icon>
);

export const IconChartAreaLine = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 19l4 -6l4 2l4 -5l4 4l0 5l-16 0" />
    <path d="M4 12l3 -4l4 2l5 -6l4 4" />
  </Icon>
);
