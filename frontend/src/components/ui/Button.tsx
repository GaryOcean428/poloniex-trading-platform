import * as React from "react";
import { cn } from "@/utils/cn";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "secondary" | "outline" | "ghost" | "link" | "danger";
  size?: "default" | "sm" | "lg" | "icon";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", isLoading, children, ...props }, ref) => {
    const baseStyles = "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";
    
    const variants = {
      default: "bg-brand-cyan text-text-inverse hover:opacity-90",
      primary: "bg-brand-cyan text-text-inverse hover:opacity-90",
      secondary: "bg-bg-secondary text-text-primary border border-border-moderate hover:bg-bg-tertiary",
      outline: "border border-border-moderate hover:bg-bg-secondary",
      ghost: "hover:bg-bg-secondary",
      link: "underline-offset-4 hover:underline text-brand-cyan",
      danger: "bg-error text-text-inverse hover:opacity-90",
    };
    
    const sizes = {
      default: "h-10 py-2 px-4",
      sm: "h-9 px-3 rounded-md",
      lg: "h-11 px-8 rounded-md",
      icon: "h-10 w-10",
    };
    
    return (
      <button
        className={cn(
          baseStyles,
          variants[variant],
          sizes[size],
          isLoading && "opacity-70 cursor-not-allowed",
          className
        )}
        ref={ref}
        disabled={isLoading || props.disabled}
        {...props}
      >
        {isLoading ? (
          <span className="mr-2 animate-spin">⟳</span>
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
