// Request-scoped instrumentation for local quota tests only. Never caches data.
export function measureDb(binding: D1Database) {
  const counts = { reads: 0, writes: 0, queries: 0 };
  const originals = new WeakMap<object, D1PreparedStatement>();
  function record(result: D1Result) {
    counts.reads += result.meta.rows_read;
    counts.writes += result.meta.rows_written;
    counts.queries++;
    return result;
  }
  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    const proxy = new Proxy(statement, {
      get(target, key) {
        if (key === "bind")
          return (...values: unknown[]) => wrap(target.bind(...values));
        if (key === "first")
          return async (column?: string) => {
            const result = record(await target.all());
            const row = result.results[0] as
              | Record<string, unknown>
              | undefined;
            return column ? (row?.[column] ?? null) : (row ?? null);
          };
        if (key === "all") return async () => record(await target.all());
        if (key === "run") return async () => record(await target.run());
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    originals.set(proxy, statement);
    return proxy;
  }
  const db = new Proxy(binding, {
    get(target, key) {
      if (key === "prepare")
        return (query: string) => wrap(target.prepare(query));
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
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
