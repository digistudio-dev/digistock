/**
 * Impression HTML via un iframe isolé : ouvre la boîte de dialogue Windows
 * (choix de l'imprimante, aperçu, nombre de copies).
 */
export function printHtml(html: string, opts: { pageCss?: string; copies?: number } = {}) {
  return new Promise<void>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc) {
      iframe.remove();
      resolve();
      return;
    }
    const copies = Math.max(1, Math.min(opts.copies ?? 1, 10));
    const body = Array.from({ length: copies }, () => `<div class="copy">${html}</div>`).join("");
    doc.open();
    doc.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>DigiStock</title>
      <style>
        ${opts.pageCss ?? "@page { size: A4; margin: 14mm; }"}
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .copy { page-break-after: always; }
        .copy:last-child { page-break-after: auto; }
      </style></head><body>${body}</body></html>`);
    doc.close();
    const done = () => {
      setTimeout(() => {
        iframe.remove();
        resolve();
      }, 500);
    };
    const run = () => {
      const win = iframe.contentWindow;
      if (!win) return done();
      win.focus();
      win.onafterprint = done;
      win.print();
      // Certains moteurs ne déclenchent pas `afterprint` : nettoyage de sécurité.
      setTimeout(done, 60_000);
    };
    const imgs = Array.from(doc.images);
    if (imgs.length === 0) setTimeout(run, 50);
    else
      Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => ((i.onload = r), (i.onerror = r)))))).then(() =>
        setTimeout(run, 50),
      );
  });
}

export const escapeHtml = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
