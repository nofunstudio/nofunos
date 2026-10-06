// `next/image` in an artifact: a plain <img>. Static imports arrive as data URLs (string) or
// `{ src }` objects; `fill` positions the image over its parent like Next does.
import * as React from "react";

type StaticImage = { src: string; width?: number; height?: number };
type ImageProps = Omit<React.ComponentProps<"img">, "src"> & {
  src: string | StaticImage;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  placeholder?: string;
  blurDataURL?: string;
  unoptimized?: boolean;
  loader?: unknown;
  overrideSrc?: string;
};

const Image = React.forwardRef<HTMLImageElement, ImageProps>(function Image(
  {
    src,
    fill,
    priority,
    quality: _quality,
    placeholder: _placeholder,
    blurDataURL: _blur,
    unoptimized: _unoptimized,
    loader: _loader,
    overrideSrc,
    style,
    width,
    height,
    loading,
    ...rest
  },
  ref,
) {
  const resolved = overrideSrc ?? (typeof src === "string" ? src : src?.src);
  const fillStyle: React.CSSProperties | undefined = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
    : undefined;
  return (
    <img
      ref={ref}
      src={resolved}
      width={fill ? undefined : (width ?? (typeof src === "object" ? src.width : undefined))}
      height={fill ? undefined : (height ?? (typeof src === "object" ? src.height : undefined))}
      loading={loading ?? (priority ? "eager" : undefined)}
      decoding="async"
      style={fillStyle ? { ...fillStyle, ...style } : style}
      {...rest}
    />
  );
});

export default Image;
export function getImageProps(props: ImageProps) {
  return { props: { ...props, src: typeof props.src === "string" ? props.src : props.src.src } };
}
