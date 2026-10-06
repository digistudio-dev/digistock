// Prépare le service WhatsApp pour Tauri :
//  1. installe les dépendances du sidecar si nécessaire (sans télécharger Chromium) ;
//  2. regroupe le service en un seul fichier `src-tauri/resources/whatsapp/index.cjs` ;
//  3. copie l'exécutable Node.js courant comme binaire externe Tauri (`binaries/node-<triple>.exe`).
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidecar = join(root, "sidecar", "whatsapp");
const outDir = join(root, "src-tauri", "resources", "whatsapp");
const binDir = join(root, "src-tauri", "binaries");

if (!existsSync(join(sidecar, "node_modules", "whatsapp-web.js"))) {
  console.log("[sidecar] Installation des dépendances…");
  execSync("npm install --no-audit --no-fund", {
    cwd: sidecar,
    stdio: "inherit",
    env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "1", PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: "1" },
  });
}

mkdirSync(outDir, { recursive: true });
await build({
  entryPoints: [join(sidecar, "src", "index.js")],
  outfile: join(outDir, "index.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  minify: true,
  legalComments: "none",
  logLevel: "warning",
  // Modules optionnels jamais chargés à l'exécution (natifs de ws, S3 d'unzipper).
  external: ["bufferutil", "utf-8-validate", "@aws-sdk/client-s3"],
  absWorkingDir: sidecar,
});
console.log(`[sidecar] Service regroupé (${Math.round(statSync(join(outDir, "index.cjs")).size / 1024)} Ko).`);

let triple = process.env.TAURI_ENV_TARGET_TRIPLE;
if (!triple) {
  try {
    triple = execSync("rustc -vV", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).match(/host: (\S+)/)?.[1];
  } catch {
    // rustc absent du PATH : cible Windows 64 bits par défaut.
  }
}
triple ??= "x86_64-pc-windows-msvc";
mkdirSync(binDir, { recursive: true });
const ext = process.platform === "win32" ? ".exe" : "";
const target = join(binDir, `node-${triple}${ext}`);
if (!existsSync(target) || statSync(target).size !== statSync(process.execPath).size) {
  copyFileSync(process.execPath, target);
  console.log(`[sidecar] Node.js copié vers ${target}`);
}
