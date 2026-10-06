// Ported from nofun-components components/ui/button.tsx (Kobra Button): base, variant and size classes
// verbatim, minus the `push` variant and the Base UI wrapper. Renders a native <button>.
import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/cn.ts";

const buttonVariants = cva(
  "group/button relative isolate inline-flex shrink-0 items-center justify-center rounded-lg bg-clip-padding text-sm font-medium whitespace-nowrap transition-ring outline-none select-none before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:border before:border-transparent before:transition-[scale,background-color,border-color] before:duration-150 before:ease-out focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:before:transition-none active:not-aria-[haspopup]:not-data-[variant=push]:before:scale-[0.99] data-pressed:not-data-[variant=push]:before:scale-[0.99] motion-reduce:active:before:scale-100 motion-reduce:data-pressed:before:scale-100 disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "t-surface t-surface-primary text-primary-foreground",
        outline: "t-surface t-surface-outline text-foreground",
        secondary: "t-surface t-surface-secondary text-secondary-foreground",

        ghost:
          "text-foreground hover:before:bg-foreground/7 aria-expanded:before:bg-foreground/7 active:not-aria-[haspopup]:before:bg-foreground/12 data-pressed:before:bg-foreground/12",

        destructive:
          "t-surface t-surface-destructive text-destructive-foreground focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-2 px-4 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-[min(var(--radius-md),12px)]",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "outline",
  size = "default",
  type = "button",
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      type={type}
      data-slot="button"
      data-variant={variant ?? undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
