import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, type, id: idProp, ...props }, ref) => {
    const id = idProp ?? (label ? `input-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-primary">
            {label}
          </label>
        )}
        <input
          id={id}
          type={type}
          {...(id ? { name: id } : {})}
          className={cn(
            "flex h-11 w-full rounded-lg border border-border bg-surface px-4 py-2 text-sm text-primary placeholder:text-muted transition-colors",
            "focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/10",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-danger",
            className
          )}
          ref={ref}
          {...props}
        />
        {error && (
          <p className="mt-1 text-xs text-danger">{error}</p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
