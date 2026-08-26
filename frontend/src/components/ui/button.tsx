import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-white text-black shadow-sm hover:bg-neutral-100 hover:scale-105",
        destructive: "bg-neon-pink text-white shadow-glow-pink hover:shadow-glow-pink hover:scale-105",
        outline: "border border-border bg-transparent hover:bg-glass-bg hover:border-electric-blue hover:shadow-glow-blue",
        secondary: "bg-glass-bg border border-glass-border backdrop-blur-lg hover:border-neon-purple hover:shadow-glow-purple",
        ghost: "hover:bg-black/10 dark:hover:bg-white/10",
        link: "text-electric-blue underline-offset-4 hover:underline hover:text-neon-purple",
        premium: "bg-gradient-premium text-white shadow-glow-purple hover:shadow-glow-purple hover:scale-105",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 rounded-lg px-4",
        lg: "h-12 rounded-lg px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
