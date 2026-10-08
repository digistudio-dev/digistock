import { invoke } from "@tauri-apps/api/core";

/** Erreur renvoyée par le backend : `{ code, message }` (message en français). */
export class AppError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e && typeof e === "object" && "message" in e) {
    const obj = e as { code?: string; message: string };
    return new AppError(obj.code ?? "internal", obj.message);
  }
  if (typeof e === "string") return new AppError("internal", e);
  return new AppError("internal", "Une erreur inattendue s'est produite.");
}

/** Appelle une commande Rust en normalisant les erreurs. */
export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toAppError(e);
  }
}

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
