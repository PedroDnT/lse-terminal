// Dependency-free stand-in for the shadcn/radix Collapsible. The ported
// visualization components use the same three-part API as the website, but
// the terminal bundle does not carry @radix-ui/react-collapsible; this shim
// keeps the ports verbatim without adding the dependency. Controlled and
// uncontrolled open state are both supported because the ports use both.
import * as React from "react";

type Ctx = { open: boolean; toggle: () => void };
const CollapsibleCtx = React.createContext<Ctx>({ open: false, toggle: () => {} });

interface CollapsibleProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const Collapsible = ({ open, defaultOpen, onOpenChange, children, ...props }: CollapsibleProps) => {
  const [inner, setInner] = React.useState(!!defaultOpen);
  const isOpen = open !== undefined ? open : inner;
  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setInner(next);
    onOpenChange?.(next);
  };
  return (
    <CollapsibleCtx.Provider value={{ open: isOpen, toggle }}>
      <div {...props}>{children}</div>
    </CollapsibleCtx.Provider>
  );
};

interface TriggerProps extends React.HTMLAttributes<HTMLElement> {
  asChild?: boolean;
}

const CollapsibleTrigger = ({ asChild, children, onClick, ...props }: TriggerProps) => {
  const { toggle } = React.useContext(CollapsibleCtx);
  // asChild: clone the single child (radix semantics) so trigger buttons keep
  // their own styling instead of gaining a wrapper element.
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement, {
      onClick: (e: React.MouseEvent) => {
        (children as any).props?.onClick?.(e);
        toggle();
      },
    });
  }
  return (
    <button
      type="button"
      onClick={(e) => { onClick?.(e as any); toggle(); }}
      {...props}
    >
      {children}
    </button>
  );
};

const CollapsibleContent = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  const { open } = React.useContext(CollapsibleCtx);
  if (!open) return null;
  return <div {...props}>{children}</div>;
};

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
