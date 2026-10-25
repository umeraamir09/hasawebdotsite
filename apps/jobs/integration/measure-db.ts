// Request-scoped quota instrumentation, disabled for native CPU measurements.
export function measureDb(
  binding: D1Database,
  beforeExecute?: (query: string) => Promise<void>,
) {
  const counts = { reads: 0, writes: 0, queries: 0 };
  const originals = new WeakMap<object, D1PreparedStatement>();
  const queries = new WeakMap<object, string>();
  function record(result: D1Result) {
    counts.reads += result.meta.rows_read;
    counts.writes += result.meta.rows_written;
    counts.queries++;
    return result;
  }
  function wrap(
    statement: D1PreparedStatement,
    query: string,
  ): D1PreparedStatement {
    const proxy = new Proxy(statement, {
      get(target, key) {
        if (key === "bind")
          return (...values: unknown[]) => wrap(target.bind(...values), query);
        if (key === "first")
          return async (column?: string) => {
            await beforeExecute?.(query);
            const result = record(await target.all());
            const row = result.results[0] as
              | Record<string, unknown>
              | undefined;
            return column ? (row?.[column] ?? null) : (row ?? null);
          };
        if (key === "all")
          return async () => {
            await beforeExecute?.(query);
            return record(await target.all());
          };
        if (key === "raw")
          return async (options?: { columnNames?: boolean }) => {
            await beforeExecute?.(query);
            const result = record(await target.all());
            // Drizzle's own D1 batch mapping uses this same ordered conversion.
            const rows = result.results.map((row) =>
              Object.values(row as Record<string, unknown>),
            );
            return options?.columnNames
              ? [Object.keys(result.results[0] ?? {}), ...rows]
              : rows;
          };
        if (key === "run")
          return async () => {
            await beforeExecute?.(query);
            return record(await target.run());
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    originals.set(proxy, statement);
    queries.set(proxy, query);
    return proxy;
  }
  const db = new Proxy(binding, {
    get(target, key) {
      if (key === "prepare")
        return (query: string) => wrap(target.prepare(query), query);
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          for (const statement of statements)
            await beforeExecute?.(queries.get(statement) ?? "");
          const result = await target.batch(
            statements.map(
              (statement) => originals.get(statement) ?? statement,
            ),
          );
          return result.map(record);
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db, counts };
}
