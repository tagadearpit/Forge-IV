'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type SafeImageProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  priority?: boolean;
  className?: string;
  wrapperClassName?: string;
};

/** Local illustration with reserved geometry and a branded fallback on load failure. */
export function SafeImage({
  src,
  alt,
  width,
  height,
  sizes,
  priority = false,
  className,
  wrapperClassName,
}: SafeImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  return (
    <div
      className={cn('relative overflow-hidden', wrapperClassName)}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {failed ? (
        <div
          className="absolute inset-0 bg-gradient-to-br from-brand-100 via-cream-100 to-brand-200 dark:from-brand-950 dark:via-slate-900 dark:to-brand-900"
          aria-hidden="true"
        />
      ) : (
        <Image
          src={src}
          alt={alt}
          aria-hidden={alt === '' ? true : undefined}
          width={width}
          height={height}
          sizes={sizes}
          priority={priority}
          loading={priority ? undefined : 'lazy'}
          onError={() => setFailed(true)}
          className={cn('block', className)}
        />
      )}
    </div>
  );
}
