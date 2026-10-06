/**
 * DigiStock — service WhatsApp local.
 *
 * Protocole : une ligne JSON par message sur stdin/stdout. Aucun port réseau n'est ouvert.
 *   → { "id": 1, "cmd": "send", "args": { "phone": "2126...", "message": "...", "attachment"?: {...} } }
 *   ← { "id": 1, "ok": true, "result": {...} } | { "id": 1, "ok": false, "error": "..." }
 *   ← { "event": "qr" | "authenticated" | "ready" | "disconnected" | "auth_failure" | "error" | "log", ... }
 *
 * Variables d'environnement fournies par DigiStock :
 *   WA_SESSION_DIR : dossier de session (LocalAuth, persistant)
 *   WA_BROWSER     : chemin de Microsoft Edge / Google Chrome
 */
const readline = require("node:readline");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const log = (message) => emit({ event: "log", message });

const sessionDir = process.env.WA_SESSION_DIR;
const browser = process.env.WA_BROWSER;
if (!sessionDir || !browser) {
  emit({ event: "error", message: "Configuration du service WhatsApp incomplète." });
  process.exit(1);
}

let ready = false;
let shuttingDown = false;

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "digistock", dataPath: sessionDir }),
  puppeteer: {
    headless: true,
    executablePath: browser,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check"],
  },
  takeoverOnConflict: true,
});

client.on("qr", (qr) => emit({ event: "qr", qr }));
client.on("loading_screen", (percent) => emit({ event: "loading", percent }));
client.on("authenticated", () => emit({ event: "authenticated" }));
client.on("auth_failure", (msg) =>
  emit({ event: "auth_failure", message: "Échec d'authentification WhatsApp. Reconnectez-vous. " + (msg || "") }),
);
client.on("ready", () => {
  ready = true;
  const info = client.info || {};
  emit({ event: "ready", number: info.wid ? info.wid.user : null, name: info.pushname || null });
});
client.on("disconnected", (reason) => {
  ready = false;
  log("Déconnecté : " + reason);
  emit({ event: "disconnected", reason: String(reason) });
  if (!shuttingDown) setTimeout(() => process.exit(0), 500);
});

async function send({ phone, message, attachment }) {
  if (!ready) throw new Error("WhatsApp n'est pas encore connecté.");
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10) throw new Error("Numéro WhatsApp invalide.");
  const numberId = await client.getNumberId(digits);
  if (!numberId) throw new Error("Ce numéro n'utilise pas WhatsApp.");
  const chatId = numberId._serialized;
  if (attachment && attachment.base64) {
    const media = new MessageMedia(attachment.mimetype, attachment.base64, attachment.filename);
    const sent = await client.sendMessage(chatId, media, { caption: message, sendMediaAsDocument: true });
    return { messageId: sent.id ? sent.id._serialized : null };
  }
  const sent = await client.sendMessage(chatId, message);
  return { messageId: sent.id ? sent.id._serialized : null };
}

async function shutdown(code = 0) {
  shuttingDown = true;
  try {
    await client.destroy();
  } catch (_) {
    /* ignore */
  }
  process.exit(code);
}

const handlers = {
  status: async () => ({ ready, number: client.info && client.info.wid ? client.info.wid.user : null }),
  send,
  logout: async () => {
    shuttingDown = true;
    try {
      await client.logout();
    } catch (_) {
      /* session déjà fermée */
    }
    return { ok: true };
  },
  shutdown: async () => {
    setTimeout(() => shutdown(0), 50);
    return { ok: true };
  },
};

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const handler = handlers[msg.cmd];
  if (!handler) return emit({ id: msg.id, ok: false, error: "Commande inconnue." });
  try {
    const result = await handler(msg.args || {});
    emit({ id: msg.id, ok: true, result });
  } catch (e) {
    emit({ id: msg.id, ok: false, error: e && e.message ? e.message : String(e) });
  }
});
// DigiStock fermé : on arrête proprement le navigateur.
rl.on("close", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("unhandledRejection", (e) => log("Erreur non gérée : " + (e && e.message ? e.message : String(e))));

client.initialize().catch((e) => {
  emit({ event: "error", message: "Impossible de démarrer WhatsApp : " + (e && e.message ? e.message : String(e)) });
  setTimeout(() => process.exit(1), 200);
});
