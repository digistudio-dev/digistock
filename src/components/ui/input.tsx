import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, type SelectHTMLAttributes, type LabelHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-md border border-input bg-surface text-[0.875rem] text-foreground shadow-[inset_0_1px_1px_rgb(0_0_0/0.02)] transition-colors placeholder:text-muted-foreground/70 hover:border-foreground/25 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode;
  trailing?: ReactNode;
  inputSize?: "sm" | "md" | "lg";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, leading, trailing, inputSize = "md", ...props }, ref) => {
  const h = inputSize === "sm" ? "h-8" : inputSize === "lg" ? "h-11 text-[0.9375rem]" : "h-9";
  if (!leading && !trailing) return <input ref={ref} className={cn(fieldBase, h, "px-3", className)} {...props} />;
  return (
    <div className={cn("relative flex items-center", className)}>
      {leading && <span className="pointer-events-none absolute left-3 flex text-muted-foreground [&_svg]:size-4">{leading}</span>}
      <input ref={ref} className={cn(fieldBase, h, leading ? "pl-9" : "pl-3", trailing ? "pr-12" : "pr-3")} {...props} />
      {trailing && <span className="absolute right-3 flex items-center text-[0.8125rem] text-muted-foreground">{trailing}</span>}
    </div>
  );
});
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "min-h-[84px] resize-y px-3 py-2 leading-relaxed", className)} {...props} />
));
Textarea.displayName = "Textarea";

/** Liste déroulante native stylée : rapide, accessible et navigable au clavier. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { inputSize?: "sm" | "md" }>(
  ({ className, children, inputSize = "md", ...props }, ref) => (
    <div className={cn("relative", className)}>
      <select ref={ref} className={cn(fieldBase, inputSize === "sm" ? "h-8" : "h-9", "cursor-pointer appearance-none pl-3 pr-8")} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  ),
);
Select.displayName = "Select";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[0.8125rem] font-medium text-foreground/90", className)} {...props} />;
}

export function Field({
  label,
  error,
  hint,
  required,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </Label>
      )}
      {children}
      {error ? <p className="text-[0.75rem] font-medium text-danger">{error}</p> : hint ? <p className="text-[0.75rem] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
