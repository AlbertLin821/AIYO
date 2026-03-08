import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "outline";
  removable?: boolean;
  onRemove?: () => void;
}

export function Tag({
  children,
  className,
  variant = "default",
  removable = false,
  onRemove,
  ...props
}: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-btn px-3 py-1 text-xs font-medium",
        variant === "default" && "bg-surface-muted text-primary",
        variant === "outline" && "border border-border text-primary",
        className
      )}
      {...props}
    >
      {children}
      {removable && (
        <button
          onClick={onRemove}
          className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-black/10 transition-colors"
          aria-label="Remove"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}
