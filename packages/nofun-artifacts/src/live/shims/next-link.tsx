// `next/link` in an artifact: a plain anchor. Prefetch and routing props are dropped.
import * as React from "react";

type Href = string | { pathname?: string; query?: Record<string, string>; hash?: string };
type LinkProps = Omit<React.ComponentProps<"a">, "href"> & {
  href: Href;
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
  locale?: string | false;
};

function toHref(href: Href): string {
  if (typeof href === "string") return href;
  const query = href.query ? `?${new URLSearchParams(href.query).toString()}` : "";
  return `${href.pathname ?? ""}${query}${href.hash ? `#${href.hash}` : ""}`;
}

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  {
    href,
    prefetch: _prefetch,
    replace: _replace,
    scroll: _scroll,
    shallow: _shallow,
    passHref: _passHref,
    legacyBehavior: _legacy,
    locale: _locale,
    ...rest
  },
  ref,
) {
  return <a ref={ref} href={toHref(href)} {...rest} />;
});

export default Link;
