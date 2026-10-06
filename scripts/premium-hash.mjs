// Calcule l'empreinte SHA-256 d'un code d'activation DigiStock Premium.
// Usage : npm run premium:hash -- DGS-XXXX-XXXX-XXXX-XXXX
//         npm run premium:hash -- --generate 5
// Copiez les empreintes dans src-tauri/src/premium_codes.rs. Ne commitez jamais les codes en clair.
import { createHash, randomInt } from "node:crypto";

const PEPPER = "digistock:v1:";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const normalize = (code) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hashCode = (code) => createHash("sha256").update(PEPPER + normalize(code)).digest("hex");

const generate = () =>
  "DGS-" + Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")).join("-");

const args = process.argv.slice(2);
if (args[0] === "--generate") {
  const n = Number(args[1] ?? 5);
  for (let i = 0; i < n; i++) {
    const c = generate();
    console.log(`${c}  ${hashCode(c)}`);
  }
} else if (args.length) {
  for (const c of args) console.log(hashCode(c));
} else {
  console.error("Usage : npm run premium:hash -- <CODE> | --generate 5");
  process.exit(1);
}
