// Adaptateur de test : les transactions restent exclusives sur la connexion WASM.
// Les requêtes SQL et les migrations de production sont exécutées sans simulation.
export function createTestPool(db) {
  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    return release;
  };
  const query = async (sql, params) => {
    const result = params ? await db.query(sql, params) : (await db.exec(sql)).at(-1);
    return { ...result, rows: result?.rows ?? [], rowCount: result?.rows?.length || result?.affectedRows || 0 };
  };
  return {
    async query(sql, params) { const release = await acquire(); try { return await query(sql, params); } finally { release(); } },
    async connect() { const release = await acquire(); return { query, release }; },
  };
}
