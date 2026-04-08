import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /** Renders inside the field on the right (e.g. password visibility toggle) */
  endAdornment?: React.ReactNode;
  autoComplete?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, type, id: idProp, endAdornment, autoComplete: autoCompleteProp, ...props }, ref) => {
    const id = idProp ?? (label ? `input-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
    const derivedAutoComplete = autoCompleteProp ?? (type === "password" ? "current-password" : type === "email" ? "email" : undefined);
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-primary">
            {label}
          </label>
        )}
        <div
          className={cn(
            "flex h-11 w-full items-stretch overflow-hidden rounded-lg border border-border bg-surface transition-colors duration-200 ease-smooth",
            "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15",
            error && "border-danger",
            endAdornment && "pr-0"
          )}
        >
          <input
            id={id}
            type={type}
            autoComplete={derivedAutoComplete}
            {...(id ? { name: id } : {})}
            className={cn(
              "min-w-0 flex-1 border-0 bg-transparent px-4 py-2 text-sm text-primary placeholder:text-muted outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
              endAdornment && "pr-1",
              className
            )}
            ref={ref}
            {...props}
          />
          {endAdornment ? (
            <div className="flex shrink-0 items-center pr-2">{endAdornment}</div>
          ) : null}
        </div>
        {error && (
          <p className="mt-1 text-xs text-danger">{error}</p>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
