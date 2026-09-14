import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 border border-border bg-paper px-2 py-1 font-body text-xs font-medium tracking-[-0.005em] text-text-muted", className)}
      {...props}
    />
  );
}
