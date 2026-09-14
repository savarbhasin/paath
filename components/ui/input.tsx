import * as React from "react";

import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full border border-border bg-white px-3 font-body text-sm text-text outline-none placeholder:text-text-dim focus:border-blue",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";
