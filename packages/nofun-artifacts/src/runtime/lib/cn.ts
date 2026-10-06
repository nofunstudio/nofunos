// The `cn` No Fun components import from `@/lib/utils` (the `cn` package: clsx + tailwind-merge).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
