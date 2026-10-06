// Prépare les fichiers d'une version à publier sur GitHub Releases :
//   release/v<version>/DigiStock_<version>_x64-setup.exe
//   release/v<version>/DigiStock_<version>_x64-setup.exe.sig
//   release/v<version>/latest.json   (lu par la mise à jour automatique)
//
// Usage : npm run release:prepare -- "Notes de version"
// Prérequis : `npm run tauri build` avec TAURI_SIGNING_PRIVATE_KEY défini.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = conf.version;
const repo = "digistudio-dev/digistock";
const target = process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR) : join(root, "src-tauri", "target");
const nsis = join(target, "release", "bundle", "nsis");
const exe = `DigiStock_${version}_x64-setup.exe`;

if (!existsSync(join(nsis, exe)) || !existsSync(join(nsis, exe + ".sig"))) {
  console.error(`Introuvable : ${join(nsis, exe)} (+ .sig). Lancez d'abord « npm run tauri build » avec la clé de signature.`);
  process.exit(1);
}

const out = join(root, "release", `v${version}`);
mkdirSync(out, { recursive: true });
copyFileSync(join(nsis, exe), join(out, exe));
copyFileSync(join(nsis, exe + ".sig"), join(out, exe + ".sig"));

const notes = process.argv.slice(2).join(" ").trim() || `DigiStock ${version}`;
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(join(nsis, exe + ".sig"), "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/v${version}/${exe}`,
    },
  },
};
writeFileSync(join(out, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Version ${version} prête dans ${out}`);
console.log(`Publiez la release GitHub « v${version} » avec ces 3 fichiers : ${exe}, ${exe}.sig, latest.json`);
