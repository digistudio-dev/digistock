import { convertFileSrc } from "@tauri-apps/api/core";
import { call } from "./tauri";

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function textToBase64(text: string) {
  return bytesToBase64(new TextEncoder().encode(text));
}

export async function blobToBase64(blob: Blob) {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** Ouvre la boîte « Enregistrer sous » native et écrit le fichier. Retourne le chemin ou null si annulé. */
export function saveFile(defaultName: string, base64: string, filterName: string, extensions: string[]) {
  return call<string | null>("file_save", { defaultName, dataBase64: base64, filterName, extensions });
}

export const saveCsv = (name: string, csv: string) => saveFile(name, textToBase64(csv), "Fichier CSV", ["csv"]);
export const savePdf = (name: string, base64: string) => saveFile(name, base64, "Document PDF", ["pdf"]);

let imagesDir = "";
export function setImagesDir(dir: string) {
  imagesDir = dir;
}

/** URL affichable d'une image stockée localement (protocole asset limité au dossier images). */
export function imageSrc(name: string | null | undefined) {
  if (!name) return null;
  if (name.startsWith("data:")) return name;
  if (!imagesDir) return null;
  const sep = imagesDir.includes("\\") ? "\\" : "/";
  return convertFileSrc(`${imagesDir}${sep}${name}`);
}

/** Redimensionne une image côté client puis la stocke dans le dossier de l'application. */
export async function storeImage(file: File, maxSize = 512): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Le fichier sélectionné n'est pas une image.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Image illisible."));
      i.src = url;
    });
    const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * ratio);
    canvas.height = Math.round(img.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Traitement de l'image impossible.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const keepPng = file.type === "image/png";
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Conversion impossible."))), keepPng ? "image/png" : "image/jpeg", 0.88),
    );
    return call<string>("image_store", { dataBase64: await blobToBase64(blob), ext: keepPng ? "png" : "jpg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Charge une image locale en data URL (pour l'intégrer à un PDF). */
export async function imageToDataUrl(name: string | null | undefined): Promise<string | null> {
  const src = imageSrc(name);
  if (!src) return null;
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}
