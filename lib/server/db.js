import { createPostgresDb } from './postgresDb.js';
import { createSqliteDb } from './sqliteDb.js';

export function createServerDb(config) {
  if (config.persistenceDriver === 'postgres') {
    return createPostgresDb({
      connectionString: config.postgresConnectionString,
      ssl: config.postgresSsl,
    });
  }

  return createSqliteDb({ dbPath: config.dbPath });
}
