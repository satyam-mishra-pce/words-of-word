import { Pool } from 'pg';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type AnalyticsMetricDelta = {
  id: string;
  occurredAt: string;
  payload: unknown;
};

export interface AnalyticsPersistence {
  readonly kind: 'file' | 'postgres';
  readonly supportsMetricWindows: boolean;
  load(): Promise<unknown | undefined>;
  save(data: unknown, deltas: readonly AnalyticsMetricDelta[]): Promise<void>;
  readMetricDeltas(from: string, to: string): Promise<AnalyticsMetricDelta[]>;
  close(): Promise<void>;
}

export class FileAnalyticsPersistence implements AnalyticsPersistence {
  public readonly kind = 'file' as const;
  public readonly supportsMetricWindows = false;
  private writeSequence = 0;

  public constructor(private readonly filePath: string) {}

  public async load(): Promise<unknown | undefined> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
    } catch (error: unknown) {
      const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: unknown }).code : undefined;
      if (code === 'ENOENT') return undefined;
      throw error;
    }
  }

  public async save(data: unknown, _deltas: readonly AnalyticsMetricDelta[]): Promise<void> {
    const directory = dirname(this.filePath);
    const temporaryFile = `${this.filePath}.${process.pid}.${Date.now()}.${++this.writeSequence}.tmp`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temporaryFile, this.filePath);
  }

  public async readMetricDeltas(_from: string, _to: string): Promise<AnalyticsMetricDelta[]> {
    return [];
  }

  public async close(): Promise<void> {}
}

/**
 * Durable storage for production analytics. The aggregate state remains a
 * private JSON document, while timestamped metric deltas make future report
 * windows exact without storing raw player or gameplay data.
 */
export class PostgresAnalyticsPersistence implements AnalyticsPersistence {
  public readonly kind = 'postgres' as const;
  public readonly supportsMetricWindows = true;
  private initialized: Promise<void> | undefined;

  public constructor(private readonly pool: Pool) {}

  public static fromConnectionString(connectionString: string): PostgresAnalyticsPersistence {
    return new PostgresAnalyticsPersistence(new Pool({ connectionString }));
  }

  public async load(): Promise<unknown | undefined> {
    await this.ensureInitialized();
    const result = await this.pool.query<{ state: unknown }>(
      'SELECT state FROM wow_analytics_state WHERE id = 1'
    );
    return result.rows[0]?.state;
  }

  public async save(data: unknown, deltas: readonly AnalyticsMetricDelta[]): Promise<void> {
    await this.ensureInitialized();
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO wow_analytics_state (id, state, updated_at)
         VALUES (1, $1::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`,
        [JSON.stringify(data)]
      );

      if (deltas.length > 0) {
        const values: unknown[] = [];
        const rows = deltas.map((delta, index) => {
          const offset = index * 3;
          values.push(delta.id, delta.occurredAt, JSON.stringify(delta.payload));
          return `($${offset + 1}, $${offset + 2}::timestamptz, $${offset + 3}::jsonb)`;
        });
        await client.query(
          `INSERT INTO wow_analytics_metric_deltas (id, occurred_at, payload)
           VALUES ${rows.join(', ')}
           ON CONFLICT (id) DO NOTHING`,
          values
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async readMetricDeltas(from: string, to: string): Promise<AnalyticsMetricDelta[]> {
    await this.ensureInitialized();
    const result = await this.pool.query<{ id: string; occurred_at: Date; payload: unknown }>(
      `SELECT id, occurred_at, payload
       FROM wow_analytics_metric_deltas
       WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
       ORDER BY occurred_at ASC, id ASC`,
      [from, to]
    );
    return result.rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at.toISOString(),
      payload: row.payload
    }));
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  private async ensureInitialized(): Promise<void> {
    this.initialized ??= this.initialize();
    await this.initialized;
  }

  private async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS wow_analytics_state (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS wow_analytics_metric_deltas (
        id UUID PRIMARY KEY,
        occurred_at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS wow_analytics_metric_deltas_occurred_at_idx
      ON wow_analytics_metric_deltas (occurred_at)
    `);
  }
}

export function createAnalyticsPersistence(options: {
  filePath: string;
  databaseUrl?: string;
  requireDurableStorage?: boolean;
}): AnalyticsPersistence {
  if (options.databaseUrl) return PostgresAnalyticsPersistence.fromConnectionString(options.databaseUrl);
  if (options.requireDurableStorage) {
    throw new Error('ANALYTICS_DATABASE_URL is required when durable analytics storage is enabled.');
  }
  return new FileAnalyticsPersistence(options.filePath);
}
