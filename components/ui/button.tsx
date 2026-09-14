import * as React from "react";

import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "ghost" | "outline" | "danger";
  size?: "xs" | "sm" | "md" | "lg";
}

const variants = {
  default: "border border-blue bg-blue font-body text-white hover:bg-blue-hover active:scale-[0.985]",
  secondary: "border border-border-light bg-paper font-body text-text hover:bg-bg-alt active:scale-[0.985]",
  ghost: "font-body text-text-muted hover:bg-bg-alt hover:text-text active:scale-[0.985]",
  outline: "border border-border bg-white font-body text-text hover:bg-bg-alt active:scale-[0.985]",
  danger: "border border-[#f2d1cf] bg-[#fff4f3] font-body text-[#93443d] hover:bg-[#ffe3e1] active:scale-[0.985]",
};

const sizes = {
  xs: "h-7 gap-1.5 px-2 text-[11px]",
  sm: "h-8 px-2.5 text-xs",
  md: "h-10 px-3.5 text-sm",
  lg: "h-11 px-5 text-[14.5px]",
};

export function Button({ className, variant = "default", size = "md", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "pressable inline-flex items-center justify-center gap-2 font-medium tracking-[-0.005em] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
