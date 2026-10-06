// `next/navigation` in an artifact: a single static page. Navigation is a no-op and the page reads
// its search params from the frame URL when it has any.
const router = {
  push: (_href: string) => {},
  replace: (_href: string) => {},
  prefetch: (_href: string) => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
};

export function useRouter() {
  return router;
}

export function usePathname() {
  return "/";
}

export function useSearchParams() {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

export function useParams() {
  return {};
}

export function useSelectedLayoutSegment() {
  return null;
}

export function useSelectedLayoutSegments() {
  return [];
}

export function notFound(): never {
  throw new Error("Not found");
}

export function redirect(_href: string): never {
  throw new Error("Redirects are not available in an artifact");
}

export const permanentRedirect = redirect;
