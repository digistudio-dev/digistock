import { forwardRef, useEffect, useState, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { cn, parseNumber } from "@/lib/utils";

type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number | null | undefined;
  onValueChange: (v: number | null) => void;
  suffix?: string;
  decimals?: number;
  inputSize?: "sm" | "md" | "lg";
  allowEmpty?: boolean;
};

/**
 * Saisie numérique tolérante (virgule ou point), formatée à la sortie du champ.
 * Évite les flèches natives et les problèmes de locale des `<input type=number>`.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onValueChange, suffix, decimals = 2, className, inputSize, allowEmpty, onBlur, onFocus, ...props }, ref) => {
    const fmt = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "" : String(Number(v.toFixed(decimals))).replace(".", ","));
    const [text, setText] = useState(fmt(value));
    const [focused, setFocused] = useState(false);
    useEffect(() => {
      if (!focused) setText(fmt(value));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, focused]);
    return (
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        inputSize={inputSize}
        className={cn("[&_input]:num [&_input]:text-right", !suffix && "num text-right", className)}
        value={text}
        trailing={suffix}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          const n = parseNumber(text);
          if (Number.isNaN(n)) {
            if (allowEmpty) onValueChange(null);
            setText(allowEmpty ? "" : fmt(value));
          } else {
            onValueChange(n);
            setText(fmt(n));
          }
          onBlur?.(e);
        }}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.,-]/g, "");
          setText(v);
          const n = parseNumber(v);
          if (!Number.isNaN(n)) onValueChange(n);
          else if (v === "" && allowEmpty) onValueChange(null);
        }}
        {...props}
      />
    );
  },
);
NumberInput.displayName = "NumberInput";

export const MoneyInput = forwardRef<HTMLInputElement, Omit<NumberInputProps, "suffix" | "decimals">>((props, ref) => <NumberInput ref={ref} suffix="DH" decimals={2} {...props} />);
MoneyInput.displayName = "MoneyInput";
