import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const SIZES = {
  sm: "max-w-[420px]",
  md: "max-w-[540px]",
  lg: "max-w-[720px]",
  xl: "max-w-[960px]",
  full: "max-w-[1180px]",
};

export function DialogContent({
  children,
  className,
  size = "md",
  title,
  description,
  icon,
  hideClose,
  onOpenAutoFocus,
}: {
  children: ReactNode;
  className?: string;
  size?: keyof typeof SIZES;
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  hideClose?: boolean;
  onOpenAutoFocus?: (e: Event) => void;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-[hsl(228_30%_6%/0.45)] backdrop-blur-[1.5px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <D.Content
        onOpenAutoFocus={onOpenAutoFocus}
        aria-describedby={description ? undefined : undefined}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-popover text-popover-foreground shadow-pop duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98]",
          SIZES[size],
          className,
        )}
      >
        {(title || description) && (
          <div className="flex items-start gap-3 px-6 pb-2 pt-5">
            {icon && <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary [&_svg]:size-[18px]">{icon}</div>}
            <div className="min-w-0 flex-1">
              {title && <D.Title className="text-[1.0625rem] font-semibold leading-tight">{title}</D.Title>}
              {description ? (
                <D.Description className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{typeof title === "string" ? title : "Boîte de dialogue"}</D.Description>
              )}
            </div>
          </div>
        )}
        {!title && <D.Title className="sr-only">Boîte de dialogue</D.Title>}
        {!title && !description && <D.Description className="sr-only">Boîte de dialogue</D.Description>}
        {children}
        {!hideClose && (
          <D.Close className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <X className="size-4" />
            <span className="sr-only">Fermer</span>
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-3", className)}>{children}</div>;
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center justify-end gap-2 border-t bg-subtle px-6 py-3.5 rounded-b-xl", className)}>{children}</div>;
}
