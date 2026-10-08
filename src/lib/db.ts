import { call } from "./tauri";

type Param = string | number | boolean | null | undefined;

/** Requête en lecture seule (vérifiée côté Rust). */
export function select<T = Record<string, unknown>>(sql: string, params: Param[] = []): Promise<T[]> {
  return call<T[]>("db_select", { sql, params: params.map((p) => (p === undefined ? null : p)) });
}

export async function one<T = Record<string, unknown>>(sql: string, params: Param[] = []): Promise<T | null> {
  const rows = await select<T>(sql, params);
  return rows[0] ?? null;
}

export async function scalar<T = number>(sql: string, params: Param[] = []): Promise<T> {
  const row = await one<Record<string, unknown>>(sql, params);
  return (row ? Object.values(row)[0] : null) as T;
}

export interface Page<T> {
  rows: T[];
  total: number;
}

/** Pagination côté SQL : ne charge jamais une table entière dans React. */
export async function paged<T>(
  baseSql: string,
  params: Param[],
  opts: { page: number; pageSize: number; orderBy: string },
): Promise<Page<T>> {
  const [rows, total] = await Promise.all([
    select<T>(`${baseSql} ORDER BY ${opts.orderBy} LIMIT ? OFFSET ?`, [...params, opts.pageSize, opts.page * opts.pageSize]),
    scalar<number>(`SELECT COUNT(*) FROM (${baseSql})`, params),
  ]);
  return { rows, total: total ?? 0 };
}

/** Échappe un terme de recherche pour LIKE. */
export const like = (term: string) => `%${term.trim().replace(/[%_\\]/g, (m) => "\\" + m)}%`;

/** Construit un ORDER BY sûr à partir d'une liste blanche. */
export function orderBy(sort: { id: string; desc: boolean } | undefined, allowed: Record<string, string>, fallback: string) {
  if (!sort || !allowed[sort.id]) return fallback;
  return `${allowed[sort.id]} ${sort.desc ? "DESC" : "ASC"}`;
}
