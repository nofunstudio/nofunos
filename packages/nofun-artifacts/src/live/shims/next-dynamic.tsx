// `next/dynamic` in an artifact: React.lazy behind a Suspense boundary.
import * as React from "react";

type Loader<P> = () => Promise<React.ComponentType<P> | { default: React.ComponentType<P> }>;

export default function dynamic<P extends object>(
  loader: Loader<P>,
  options?: { loading?: () => React.ReactNode; ssr?: boolean },
) {
  const Lazy = React.lazy(async () => {
    const loaded = await loader();
    return { default: "default" in loaded ? loaded.default : loaded };
  });
  return function Dynamic(props: P) {
    return (
      <React.Suspense fallback={options?.loading ? options.loading() : null}>
        <Lazy {...(props as P & React.JSX.IntrinsicAttributes)} />
      </React.Suspense>
    );
  };
}
