/** Paramètres applicatifs (table `settings`) et valeurs par défaut. */
export const DEFAULT_SETTINGS = {
  "sales.prices_include_tax": true,
  "sales.allow_price_edit": true,
  "sales.default_payment": "cash",
  "sales.block_credit_over_limit": true,
  "sales.sound": true,
  "stock.allow_negative": false,
  "stock.expiry_warning_days": 30,
  "reorder.lookback_days": 30,
  "reorder.safety_days": 2,
  "reorder.default_lead_time": 3,
  "receipt.format": "ticket_80",
  "receipt.show_logo": true,
  "receipt.show_ice": true,
  "receipt.show_if": true,
  "receipt.show_rc": true,
  "receipt.header": "",
  "receipt.footer": "Merci pour votre confiance.",
  "receipt.copies": 1,
  "receipt.after_sale": "ask",
  "invoice.payment_terms": "Paiement à réception.",
  "invoice.notes": "",
  "backup.auto_enabled": false,
  "backup.frequency": "daily",
  "backup.keep": 7,
  "backup.last_at": "",
  /** « link » : lien officiel wa.me (recommandé) ; « web » : connexion QR expérimentale. */
  "whatsapp.mode": "link",
  "whatsapp.template_supplier":
    "Bonjour {supplier_name},\n\nNous souhaitons commander le produit suivant :\n{product_name}\n\nStock actuel : {current_stock}\nQuantité souhaitée : {recommended_quantity}\n\nPouvez-vous nous confirmer la disponibilité ainsi que le délai de livraison ?\n\nMerci.\n{company_name}",
  "whatsapp.template_reminder":
    "Bonjour {customer_name},\n\nNous vous rappelons qu'un montant de {amount} DH reste à régler auprès de {company_name}.\n\nMerci pour votre confiance.",
  "whatsapp.template_receipt":
    "Bonjour {customer_name},\n\nVeuillez trouver ci-joint votre reçu {number} d'un montant de {amount} DH.\n\nMerci pour votre confiance.\n{company_name}",
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export type Settings = {
  -readonly [K in SettingKey]: (typeof DEFAULT_SETTINGS)[K] extends boolean
    ? boolean
    : (typeof DEFAULT_SETTINGS)[K] extends number
      ? number
      : string;
};

export function mergeSettings(rows: { key: string; value: string }[]): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      /* valeur corrompue : on garde la valeur par défaut */
    }
  }
  return out as Settings;
}
