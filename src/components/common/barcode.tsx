import JsBarcode from "jsbarcode";
import { useEffect, useRef } from "react";
import { detectFormat } from "@/lib/barcode";

/** Rendu SVG d'un code-barres (EAN-13 si valide, sinon Code128). */
export function BarcodeSvg({ value, height = 40, width = 1.6, fontSize = 12, displayValue = true, className }: { value: string; height?: number; width?: number; fontSize?: number; displayValue?: boolean; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, { format: detectFormat(value), height, width, fontSize, margin: 0, displayValue, background: "transparent", lineColor: "currentColor", font: "Inter, Arial" });
    } catch {
      ref.current.innerHTML = "";
    }
  }, [value, height, width, fontSize, displayValue]);
  return <svg ref={ref} className={className} />;
}

/** Génère le SVG d'un code-barres sous forme de chaîne (impression des étiquettes). */
export function barcodeSvgString(value: string, opts: { height?: number; width?: number; fontSize?: number } = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try {
    JsBarcode(svg, value, { format: detectFormat(value), height: opts.height ?? 36, width: opts.width ?? 1.5, fontSize: opts.fontSize ?? 11, margin: 0, background: "#ffffff", lineColor: "#000000", font: "Arial" });
  } catch {
    return "";
  }
  return svg.outerHTML;
}
