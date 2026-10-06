import type { SVGProps } from "react";

/** The No Fun XX smiley, drawn in currentColor so it follows the surrounding text. */
export function NoFunMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={7}
      strokeLinecap="round"
      role="img"
      {...props}
    >
      <path d="M9 9l16 16M25 9L9 25" />
      <path d="M39 9l16 16M55 9L39 25" />
      <path d="M12 40c4 12 36 12 40 0" />
    </svg>
  );
}
