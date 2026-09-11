import fs from 'node:fs';
import path from 'node:path';

import pg from 'pg';

function parseDotEnv(source) {
  const parsed = {};
  for (const rawLine of String(source ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex < 1) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return {};
  return parseDotEnv(fs.readFileSync(envPath, 'utf8'));
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

const env = { ...loadLocalEnv(), ...process.env };
const connectionString = env.DATABASE_URL
  ?? env.SUPABASE_DATABASE_URL
  ?? env.POSTGRES_CONNECTION_STRING
  ?? env.POSTGRES_CONNECTION_STRING_APP;

if (!connectionString) {
  console.log(JSON.stringify({
    ok: false,
    reason: 'No Postgres connection string found in process env or .env.',
  }, null, 2));
  process.exit(0);
}

const fixtureEmailPatterns = [
  '%@test.com',
  '%@example.com',
  '%@example.test',
  '%@test.test',
  'cross-user-%',
  'export-user-%',
  'inv-%',
  'esc%',
  'own-%',
  'iso-%',
  'log%-%',
  'rls-%',
  'tenant-%',
  'vwr-%',
  'priv-%',
  'rate-%',
];

const fixtureNamePatterns = [
  '%test%',
  '%fixture%',
  '%workspace a%',
  '%workspace b%',
  '%security%',
  '%isolation%',
  '%cross%',
  '%export%',
];

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  await client.query('BEGIN READ ONLY');

  const { rows: emailTables } = await client.query(`
    SELECT table_schema, table_name,
           bool_or(column_name = 'email') AS has_email,
           bool_or(column_name = 'id') AS has_id,
           bool_or(column_name = 'created_at') AS has_created_at,
           bool_or(column_name = 'workspace_id') AS has_workspace_id,
           bool_or(column_name = 'household_id') AS has_household_id
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    GROUP BY table_schema, table_name
    HAVING bool_or(column_name = 'email')
    ORDER BY table_schema, table_name
  `);

  const candidateRows = [];
  const userIds = new Set();
  const workspaceIds = new Set();
  const householdIds = new Set();

  for (const table of emailTables) {
    const columns = [
      table.has_id ? 'id::text AS id' : 'NULL::text AS id',
      'email::text AS email',
      table.has_created_at ? 'created_at::text AS created_at' : 'NULL::text AS created_at',
      table.has_workspace_id ? 'workspace_id::text AS workspace_id' : 'NULL::text AS workspace_id',
      table.has_household_id ? 'household_id::text AS household_id' : 'NULL::text AS household_id',
    ];

    const sql = `
      SELECT ${columns.join(', ')}
      FROM ${quoteIdent(table.table_schema)}.${quoteIdent(table.table_name)}
      WHERE email ILIKE ANY($1::text[])
      ORDER BY ${table.has_created_at ? 'created_at DESC' : 'email ASC'}
      LIMIT 1000
    `;
    const { rows } = await client.query(sql, [fixtureEmailPatterns]);
    for (const row of rows) {
      if (row.id) userIds.add(row.id);
      if (row.workspace_id) workspaceIds.add(row.workspace_id);
      if (row.household_id) householdIds.add(row.household_id);
      candidateRows.push({
        table: `${table.table_schema}.${table.table_name}`,
        ...row,
        confidence: 'high: fixture-style email/domain',
      });
    }
  }

  const { rows: userRelationTables } = await client.query(`
    SELECT table_schema, table_name,
           bool_or(column_name = 'user_id') AS has_user_id,
           bool_or(column_name = 'workspace_id') AS has_workspace_id,
           bool_or(column_name = 'household_id') AS has_household_id,
           bool_or(column_name = 'created_at') AS has_created_at
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    GROUP BY table_schema, table_name
    HAVING bool_or(column_name = 'user_id')
       AND bool_or(column_name IN ('workspace_id', 'household_id'))
    ORDER BY table_schema, table_name
  `);

  const membershipRows = [];
  for (const table of userRelationTables) {
    const columns = [
      'user_id::text AS user_id',
      table.has_workspace_id ? 'workspace_id::text AS workspace_id' : 'NULL::text AS workspace_id',
      table.has_household_id ? 'household_id::text AS household_id' : 'NULL::text AS household_id',
      table.has_created_at ? 'created_at::text AS created_at' : 'NULL::text AS created_at',
    ];
    const sql = `
      SELECT ${columns.join(', ')}
      FROM ${quoteIdent(table.table_schema)}.${quoteIdent(table.table_name)}
      WHERE user_id::text = ANY($1::text[])
      LIMIT 1000
    `;
    const { rows } = await client.query(sql, [[...userIds]]);
    for (const row of rows) {
      if (row.workspace_id) workspaceIds.add(row.workspace_id);
      if (row.household_id) householdIds.add(row.household_id);
      membershipRows.push({
        table: `${table.table_schema}.${table.table_name}`,
        ...row,
      });
    }
  }

  const { rows: relationTables } = await client.query(`
    SELECT table_schema, table_name,
           bool_or(column_name = 'workspace_id') AS has_workspace_id,
           bool_or(column_name = 'household_id') AS has_household_id,
           bool_or(column_name = 'name') AS has_name,
           bool_or(column_name = 'created_at') AS has_created_at
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    GROUP BY table_schema, table_name
    HAVING bool_or(column_name IN ('workspace_id', 'household_id'))
    ORDER BY table_schema, table_name
  `);

  const workspaceNameRows = [];
  for (const table of relationTables.filter((item) => item.has_name)) {
    const idColumn = table.has_workspace_id ? 'workspace_id' : 'household_id';
    const sql = `
      SELECT ${idColumn}::text AS owner_id,
             name::text AS name,
             ${table.has_created_at ? 'created_at::text' : 'NULL::text'} AS created_at
      FROM ${quoteIdent(table.table_schema)}.${quoteIdent(table.table_name)}
      WHERE name ILIKE ANY($1::text[])
      LIMIT 100
    `;
    const { rows } = await client.query(sql, [fixtureNamePatterns]);
    for (const row of rows) {
      if (table.has_workspace_id) workspaceIds.add(row.owner_id);
      if (table.has_household_id) householdIds.add(row.owner_id);
      workspaceNameRows.push({
        table: `${table.table_schema}.${table.table_name}`,
        idKind: idColumn,
        ...row,
        confidence: 'medium: fixture-style workspace/name',
      });
    }
  }

  const countRows = [];
  const idsByKind = [
    ['workspace_id', [...workspaceIds]],
    ['household_id', [...householdIds]],
  ].filter(([, ids]) => ids.length > 0);

  for (const table of relationTables) {
    for (const [idColumn, ids] of idsByKind) {
      if ((idColumn === 'workspace_id' && !table.has_workspace_id)
        || (idColumn === 'household_id' && !table.has_household_id)) {
        continue;
      }
      const sql = `
        SELECT ${idColumn}::text AS owner_id, count(*)::int AS row_count
        FROM ${quoteIdent(table.table_schema)}.${quoteIdent(table.table_name)}
        WHERE ${idColumn}::text = ANY($1::text[])
        GROUP BY ${idColumn}
        ORDER BY row_count DESC
      `;
      const { rows } = await client.query(sql, [ids]);
      for (const row of rows) {
        countRows.push({
          table: `${table.table_schema}.${table.table_name}`,
          idKind: idColumn,
          ...row,
        });
      }
    }
  }

  await client.query('ROLLBACK');

  const groupedIdentities = new Map();
  for (const row of candidateRows) {
    const group = groupedIdentities.get(row.table) ?? {
      table: row.table,
      count: 0,
      earliestCreatedAt: null,
      latestCreatedAt: null,
      sampleEmails: [],
    };
    group.count += 1;
    if (row.created_at) {
      group.earliestCreatedAt = group.earliestCreatedAt == null || row.created_at < group.earliestCreatedAt
        ? row.created_at
        : group.earliestCreatedAt;
      group.latestCreatedAt = group.latestCreatedAt == null || row.created_at > group.latestCreatedAt
        ? row.created_at
        : group.latestCreatedAt;
    }
    if (group.sampleEmails.length < 20) {
      group.sampleEmails.push(row.email);
    }
    groupedIdentities.set(row.table, group);
  }

  const groupedAffectedCounts = new Map();
  for (const row of countRows) {
    const group = groupedAffectedCounts.get(row.table) ?? {
      table: row.table,
      ownerIdKind: row.idKind,
      ownerCount: 0,
      totalRows: 0,
      sampleOwnerIds: [],
    };
    group.ownerCount += 1;
    group.totalRows += Number(row.row_count);
    if (group.sampleOwnerIds.length < 12) {
      group.sampleOwnerIds.push(row.owner_id);
    }
    groupedAffectedCounts.set(row.table, group);
  }

  console.log(JSON.stringify({
    ok: true,
    summary: {
      fixtureIdentityCount: candidateRows.length,
      membershipCount: membershipRows.length,
      workspaceIdCount: workspaceIds.size,
      householdIdCount: householdIds.size,
      affectedTableCountRows: countRows.length,
    },
    fixtureIdentityGroups: [...groupedIdentities.values()],
    fixtureIdentitySamples: candidateRows.slice(0, 40),
    fixtureMembershipSamples: membershipRows.slice(0, 80),
    associatedWorkspaceIdSamples: [...workspaceIds].slice(0, 80),
    associatedHouseholdIdSamples: [...householdIds].slice(0, 80),
    fixtureWorkspaceNames: workspaceNameRows.slice(0, 80),
    affectedTableCounts: [...groupedAffectedCounts.values()],
    notes: [
      'Read-only transaction only; no rows were deleted or updated.',
      'Confidence is heuristic and based on fixture email domains/prefixes or fixture-like workspace names.',
    ],
  }, null, 2));
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch {}
  console.log(JSON.stringify({
    ok: false,
    reason: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
