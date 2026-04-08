import * as React from "react";
import { cn } from "@/lib/utils";

interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: "sm" | "md" | "lg";
}

export function Avatar({ src, alt, fallback, size = "md", className, ...props }: AvatarProps) {
  const sizeClasses = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-14 w-14 text-base",
  };

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted text-muted font-medium",
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {src ? (
        // 使用者頭像網址可能由後端動態提供，網域無法事先完整列於 next/image 白名單，故保留原生 img。
        // eslint-disable-next-line @next/next/no-img-element -- 動態外部頭像網址
        <img
          src={src}
          alt={alt || ""}
          className="h-full w-full object-cover"
        />
      ) : (
        <span>{fallback || "?"}</span>
      )}
    </div>
  );
}
