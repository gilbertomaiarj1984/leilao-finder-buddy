// Shim que reproduz a fatia do PostgrestQueryBuilder do supabase-js realmente
// usada pelo código de negócio (ver "Surface real" em
// docs/economia-fase-2-vps-unico.md, Fase 1) — from/select/eq/upsert/
// maybeSingle/range/order/update/insert/delete/single/not/gte/lte/rpc/or/
// limit/like/in, e .storage passa direto (fica no Supabase até a Fase 3).
// Contrato: resolve sempre para { data, error } (mesmo formato que o código
// já trata), nunca lança — erros do Postgres viram { error: { message, code } }.
import { getSql } from "./db.server";

type Row = Record<string, unknown>;
type PgError = { message: string; code?: string };
type Result<T> = { data: T | null; error: PgError | null; count?: number };

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

class ParamBuilder {
  params: unknown[] = [];
  push(v: unknown): string {
    this.params.push(v);
    return `$${this.params.length}`;
  }
}

type SimpleOp = "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "like" | "ilike" | "in";
type Filter =
  | { kind: "simple"; op: SimpleOp; col: string; val: unknown }
  | { kind: "not_is_null"; col: string }
  | { kind: "not_ilike"; col: string; val: unknown }
  | { kind: "not_generic"; col: string; op: SimpleOp; val: unknown };

const SIMPLE_OP_SQL: Record<SimpleOp, string> = {
  eq: "=",
  neq: "!=",
  gte: ">=",
  lte: "<=",
  gt: ">",
  lt: "<",
  like: "LIKE",
  ilike: "ILIKE",
  in: "= ANY",
};

function simpleConditionSql(col: string, op: SimpleOp, val: unknown, pb: ParamBuilder): string {
  const c = ident(col);
  if (op === "in") return `${c} = ANY(${pb.push(val)})`;
  return `${c} ${SIMPLE_OP_SQL[op]} ${pb.push(val)}`;
}

function conditionSql(f: Filter, pb: ParamBuilder): string {
  switch (f.kind) {
    case "simple":
      return simpleConditionSql(f.col, f.op, f.val, pb);
    case "not_is_null":
      return `${ident(f.col)} IS NOT NULL`;
    case "not_ilike":
      return `${ident(f.col)} NOT ILIKE ${pb.push(f.val)}`;
    case "not_generic":
      return `NOT (${simpleConditionSql(f.col, f.op, f.val, pb)})`;
  }
}

// Sintaxe estilo PostgREST usada por .or(), ex.: "day_key.lt.X,day_key.gt.Y".
// Cobre só o que o código usa: lista de condições simples unidas por OR.
function parseOrExpr(expr: string): { col: string; op: SimpleOp; val: string }[] {
  return expr.split(",").map((part) => {
    const [col = "", op = "eq", ...rest] = part.split(".");
    return { col, op: op as SimpleOp, val: rest.join(".") };
  });
}

type OrderSpec = { col: string; ascending: boolean; nullsFirst?: boolean };

function toRows(result: unknown): Row[] {
  return (result as Row[] | null) ?? [];
}

type Mode = "list" | "single" | "maybeSingle";
// T é o formato de UMA linha; o formato do resultado depende do modo
// (.single()/.maybeSingle() reduzem de T[] pra T/T|null) — sem isso, todo
// select() sem .single() ficava tipado como se devolvesse uma linha só em vez
// de um array, e o TypeScript não via `for..of`/`.length` no resultado.
type Out<T, M extends Mode> = M extends "single" ? T : M extends "maybeSingle" ? T | null : T[];

class QueryBuilder<T = Row, M extends Mode = "list"> {
  private table: string;
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private selectCols = "*";
  private returningCols: string | null = null;
  private countExact = false;
  private headOnly = false;
  private filters: Filter[] = [];
  private orExpr: { col: string; op: SimpleOp; val: string }[] | null = null;
  private orders: OrderSpec[] = [];
  private rangeVal: { from: number; to: number } | null = null;
  private limitVal: number | null = null;
  private wantSingle: "single" | "maybeSingle" | null = null;
  private insertRows: Row[] | null = null;
  private updateRow: Row | null = null;
  private upsertRows: Row[] | null = null;
  private upsertConflict = "";

  constructor(table: string) {
    this.table = table;
  }

  select(cols?: string, opts?: { count?: "exact"; head?: boolean }): this {
    if (this.mode === "select") {
      this.selectCols = cols ?? "*";
      if (opts?.count === "exact") this.countExact = true;
      if (opts?.head) this.headOnly = true;
    } else {
      this.returningCols = cols ?? "*";
    }
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push({ kind: "simple", op: "eq", col, val });
    return this;
  }
  neq(col: string, val: unknown): this {
    this.filters.push({ kind: "simple", op: "neq", col, val });
    return this;
  }
  gte(col: string, val: unknown): this {
    this.filters.push({ kind: "simple", op: "gte", col, val });
    return this;
  }
  lte(col: string, val: unknown): this {
    this.filters.push({ kind: "simple", op: "lte", col, val });
    return this;
  }
  gt(col: string, val: unknown): this {
    this.filters.push({ kind: "simple", op: "gt", col, val });
    return this;
  }
  lt(col: string, val: unknown): this {
    this.filters.push({ kind: "simple", op: "lt", col, val });
    return this;
  }
  like(col: string, val: unknown): this {
    this.filters.push({ kind: "simple", op: "like", col, val });
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.filters.push({ kind: "simple", op: "in", col, val: vals });
    return this;
  }
  not(col: string, op: string, val: unknown): this {
    if (op === "is" && val === null) this.filters.push({ kind: "not_is_null", col });
    else if (op === "ilike") this.filters.push({ kind: "not_ilike", col, val });
    else this.filters.push({ kind: "not_generic", col, op: op as SimpleOp, val });
    return this;
  }
  or(expr: string): this {
    this.orExpr = parseOrExpr(expr);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.orders.push({ col, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst });
    return this;
  }
  range(from: number, to: number): this {
    this.rangeVal = { from, to };
    return this;
  }
  limit(n: number): this {
    this.limitVal = n;
    return this;
  }
  single(): QueryBuilder<T, "single"> {
    this.wantSingle = "single";
    return this as unknown as QueryBuilder<T, "single">;
  }
  maybeSingle(): QueryBuilder<T, "maybeSingle"> {
    this.wantSingle = "maybeSingle";
    return this as unknown as QueryBuilder<T, "maybeSingle">;
  }

  insert(rows: Row | Row[]): this {
    this.mode = "insert";
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row): this {
    this.mode = "update";
    this.updateRow = patch;
    return this;
  }
  delete(): this {
    this.mode = "delete";
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict: string }): this {
    this.mode = "upsert";
    this.upsertRows = Array.isArray(rows) ? rows : [rows];
    this.upsertConflict = opts.onConflict;
    return this;
  }

  then<TResult1 = Result<Out<T, M>>, TResult2 = never>(
    onfulfilled?: ((value: Result<Out<T, M>>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private buildWhereClause(pb: ParamBuilder): string {
    const conds = this.filters.map((f) => conditionSql(f, pb));
    if (this.orExpr) {
      const pieces = this.orExpr.map(
        (p) => `${ident(p.col)} ${SIMPLE_OP_SQL[p.op] ?? "="} ${pb.push(p.val)}`,
      );
      conds.push(`(${pieces.join(" OR ")})`);
    }
    return conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  }

  private buildOrderClause(): string {
    if (!this.orders.length) return "";
    const parts = this.orders.map((o) => {
      let s = `${ident(o.col)} ${o.ascending ? "ASC" : "DESC"}`;
      if (o.nullsFirst === true) s += " NULLS FIRST";
      else if (o.nullsFirst === false) s += " NULLS LAST";
      return s;
    });
    return `ORDER BY ${parts.join(", ")}`;
  }

  private buildLimitOffset(pb: ParamBuilder): string {
    if (this.rangeVal) {
      const { from, to } = this.rangeVal;
      return `LIMIT ${pb.push(to - from + 1)} OFFSET ${pb.push(from)}`;
    }
    if (this.limitVal != null) return `LIMIT ${pb.push(this.limitVal)}`;
    return "";
  }

  private finalize(rows: Row[]): Result<Out<T, M>> {
    if (this.wantSingle === "single") {
      if (rows.length === 0) return { data: null, error: { message: "No rows found" } };
      return { data: rows[0] as unknown as Out<T, M>, error: null };
    }
    if (this.wantSingle === "maybeSingle") {
      return { data: (rows[0] ?? null) as unknown as Out<T, M>, error: null };
    }
    return { data: rows as unknown as Out<T, M>, error: null };
  }

  private async execute(): Promise<Result<Out<T, M>>> {
    try {
      switch (this.mode) {
        case "select":
          return await this.execSelect();
        case "insert":
          return await this.execInsert();
        case "update":
          return await this.execUpdate();
        case "delete":
          return await this.execDelete();
        case "upsert":
          return await this.execUpsert();
      }
    } catch (e) {
      const err = e as { message?: string; code?: string };
      return { data: null, error: { message: err.message ?? String(e), code: err.code } };
    }
  }

  private async execSelect(): Promise<Result<Out<T, M>>> {
    const pb = new ParamBuilder();
    const cols = this.headOnly ? "count(*)::int AS count" : this.selectCols;
    const where = this.buildWhereClause(pb);
    const order = this.buildOrderClause();
    const limitOffset = this.buildLimitOffset(pb);
    const query =
      `SELECT ${cols} FROM ${ident(this.table)} ${where} ${order} ${limitOffset}`.trim();
    const rows = toRows(await getSql().unsafe(query, pb.params as never[]));
    if (this.headOnly) {
      const count = Number((rows[0] as { count?: number } | undefined)?.count ?? 0);
      return { data: null, error: null, count };
    }
    return this.finalize(rows);
  }

  private async execInsert(): Promise<Result<Out<T, M>>> {
    const rows = this.insertRows ?? [];
    if (rows.length === 0) return { data: [] as unknown as Out<T, M>, error: null };
    const pb = new ParamBuilder();
    const cols = Object.keys(rows[0] as Row);
    const colList = cols.map(ident).join(", ");
    const valuesSql = rows
      .map((row) => `(${cols.map((c) => pb.push((row as Row)[c])).join(", ")})`)
      .join(", ");
    const returning = this.returningCols ? `RETURNING ${this.returningCols}` : "";
    const query = `INSERT INTO ${ident(this.table)} (${colList}) VALUES ${valuesSql} ${returning}`;
    const rowsOut = toRows(await getSql().unsafe(query, pb.params as never[]));
    return this.finalize(rowsOut);
  }

  private async execUpdate(): Promise<Result<Out<T, M>>> {
    const patch = this.updateRow ?? {};
    const pb = new ParamBuilder();
    const setSql = Object.keys(patch)
      .map((k) => `${ident(k)} = ${pb.push(patch[k])}`)
      .join(", ");
    const where = this.buildWhereClause(pb);
    const returning = this.returningCols ? `RETURNING ${this.returningCols}` : "";
    const query = `UPDATE ${ident(this.table)} SET ${setSql} ${where} ${returning}`;
    const rowsOut = toRows(await getSql().unsafe(query, pb.params as never[]));
    return this.finalize(rowsOut);
  }

  private async execDelete(): Promise<Result<Out<T, M>>> {
    const pb = new ParamBuilder();
    const where = this.buildWhereClause(pb);
    const returning = this.returningCols ? `RETURNING ${this.returningCols}` : "";
    const query = `DELETE FROM ${ident(this.table)} ${where} ${returning}`;
    const rowsOut = toRows(await getSql().unsafe(query, pb.params as never[]));
    return this.finalize(rowsOut);
  }

  // Colunas ausentes em TODAS as linhas do lote não entram nem no INSERT nem no
  // UPDATE SET — replica o comportamento do PostgREST que protege orig_text em
  // lot-sales.server.ts (ver docstring de upsertLotSales). Assume lotes
  // internamente homogêneos (mesmo invariante que o código já depende hoje).
  private async execUpsert(): Promise<Result<Out<T, M>>> {
    const rows = this.upsertRows ?? [];
    if (rows.length === 0) return { data: [] as unknown as Out<T, M>, error: null };
    const colSet = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) colSet.add(k);
    const cols = Array.from(colSet);
    const pb = new ParamBuilder();
    const colList = cols.map(ident).join(", ");
    const valuesSql = rows
      .map((row) => `(${cols.map((c) => pb.push(c in row ? row[c] : null)).join(", ")})`)
      .join(", ");
    const updateCols = cols.filter((c) => c !== this.upsertConflict);
    const updateSet = updateCols.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(", ");
    const returning = this.returningCols ? `RETURNING ${this.returningCols}` : "";
    const query = `INSERT INTO ${ident(this.table)} (${colList}) VALUES ${valuesSql} ON CONFLICT (${ident(
      this.upsertConflict,
    )}) DO UPDATE SET ${updateSet} ${returning}`;
    const rowsOut = toRows(await getSql().unsafe(query, pb.params as never[]));
    return this.finalize(rowsOut);
  }
}

export function createDbQueryClient() {
  return {
    from<T = Row>(table: string) {
      return new QueryBuilder<T>(table);
    },
    async rpc<T = Row[]>(fnName: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
      try {
        const pb = new ParamBuilder();
        const argsSql = Object.keys(args)
          .map((k) => `${ident(k)} := ${pb.push(args[k])}`)
          .join(", ");
        const query = `SELECT * FROM ${ident(fnName)}(${argsSql})`;
        const rows = toRows(await getSql().unsafe(query, pb.params as never[]));
        return { data: rows as unknown as T, error: null };
      } catch (e) {
        const err = e as { message?: string; code?: string };
        return { data: null, error: { message: err.message ?? String(e), code: err.code } };
      }
    },
  };
}
