import * as DM from "@radix-ui/react-dropdown-menu";
import * as CM from "@radix-ui/react-context-menu";
import * as P from "@radix-ui/react-popover";
import * as T from "@radix-ui/react-tooltip";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const menuSurface =
  "z-50 min-w-[190px] overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-pop data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1";
const itemBase =
  "relative flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground";

// ---------------------------------------------------------------- Dropdown
export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({ children, align = "end", className, sideOffset = 6 }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string; sideOffset?: number }) {
  return (
    <DM.Portal>
      <DM.Content align={align} sideOffset={sideOffset} className={cn(menuSurface, className)}>
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function DropdownMenuItem({ children, onSelect, danger, disabled, shortcut }: { children: ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean; shortcut?: string }) {
  return (
    <DM.Item disabled={disabled} onSelect={onSelect} className={cn(itemBase, danger && "text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger")}>
      {children}
      {shortcut && <span className="ml-auto pl-4 text-[0.6875rem] text-muted-foreground">{shortcut}</span>}
    </DM.Item>
  );
}

export function DropdownMenuCheckboxItem({ children, checked, onCheckedChange }: { children: ReactNode; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <DM.CheckboxItem checked={checked} onCheckedChange={onCheckedChange} onSelect={(e) => e.preventDefault()} className={cn(itemBase, "pl-8")}>
      <span className="absolute left-2.5 flex size-4 items-center justify-center">
        <DM.ItemIndicator>
          <Check className="!text-primary" />
        </DM.ItemIndicator>
      </span>
      {children}
    </DM.CheckboxItem>
  );
}

export const DropdownMenuSeparator = () => <DM.Separator className="-mx-1 my-1 h-px bg-border" />;
export const DropdownMenuLabel = ({ children }: { children: ReactNode }) => (
  <DM.Label className="px-2.5 pb-1 pt-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">{children}</DM.Label>
);

// ---------------------------------------------------------------- Context menu
export const ContextMenu = CM.Root;
export const ContextMenuTrigger = CM.Trigger;

export function ContextMenuContent({ children }: { children: ReactNode }) {
  return (
    <CM.Portal>
      <CM.Content className={menuSurface}>{children}</CM.Content>
    </CM.Portal>
  );
}

export function ContextMenuItem({ children, onSelect, danger, disabled }: { children: ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <CM.Item disabled={disabled} onSelect={onSelect} className={cn(itemBase, danger && "text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger")}>
      {children}
    </CM.Item>
  );
}

export const ContextMenuSeparator = () => <CM.Separator className="-mx-1 my-1 h-px bg-border" />;

// ---------------------------------------------------------------- Popover
export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;

export function PopoverContent({ children, className, align = "start", sideOffset = 6, onOpenAutoFocus }: { children: ReactNode; className?: string; align?: "start" | "end" | "center"; sideOffset?: number; onOpenAutoFocus?: (e: Event) => void }) {
  return (
    <P.Portal>
      <P.Content align={align} sideOffset={sideOffset} onOpenAutoFocus={onOpenAutoFocus} className={cn(menuSurface, "p-0", className)}>
        {children}
      </P.Content>
    </P.Portal>
  );
}

// ---------------------------------------------------------------- Tooltip
export const TooltipProvider = T.Provider;

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  if (!content) return <>{children}</>;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-[260px] rounded-md bg-[hsl(228_24%_12%)] px-2.5 py-1.5 text-[0.75rem] font-medium text-white shadow-pop data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 dark:bg-[hsl(228_14%_22%)]"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
