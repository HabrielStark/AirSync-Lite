import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { VersionMetadata, MetadataStore } from './MetadataStore';
import { logger } from '../../utils/logger';

export class SQLiteMetadataStore implements MetadataStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const dataPath = dbPath || path.join(app.getPath('userData'), 'versions.db');
    const dataDir = path.dirname(dataPath);

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(dataPath);
    this.initializeDatabase();
    logger.info(`SQLite metadata store initialized at ${dataPath}`);
  }

  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY,
        filePath TEXT NOT NULL,
        hash TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        size INTEGER NOT NULL,
        storedPath TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_filePath ON versions(filePath);
      CREATE INDEX IF NOT EXISTS idx_createdAt ON versions(createdAt);
    `);
  }

  async save(metadata: VersionMetadata): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO versions (id, filePath, hash, createdAt, size, storedPath)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        metadata.id,
        metadata.filePath,
        metadata.hash,
        metadata.createdAt,
        metadata.size,
        metadata.storedPath
      );
      logger.debug(`Saved version metadata: ${metadata.id} for ${metadata.filePath}`);
    } catch (error) {
      logger.error(`Failed to save version metadata: ${metadata.id}`, error);
      throw error;
    }
  }

  async list(filePath: string): Promise<VersionMetadata[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM versions
      WHERE filePath = ?
      ORDER BY createdAt DESC
    `);

    try {
      const rows = stmt.all(filePath) as VersionMetadata[];
      return rows;
    } catch (error) {
      logger.error(`Failed to list versions for ${filePath}`, error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM versions WHERE id = ?');

    try {
      const info = stmt.run(id);
      if (info.changes === 0) {
        logger.warn(`Version ${id} not found for deletion`);
      } else {
        logger.debug(`Deleted version metadata: ${id}`);
      }
    } catch (error) {
      logger.error(`Failed to delete version ${id}`, error);
      throw error;
    }
  }

  async deleteByFilePath(filePath: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM versions WHERE filePath = ?');

    try {
      const info = stmt.run(filePath);
      logger.debug(`Deleted ${info.changes} version(s) for ${filePath}`);
    } catch (error) {
      logger.error(`Failed to delete versions for ${filePath}`, error);
      throw error;
    }
  }

  async getById(id: string): Promise<VersionMetadata | undefined> {
    const stmt = this.db.prepare('SELECT * FROM versions WHERE id = ?');

    try {
      const row = stmt.get(id) as VersionMetadata | undefined;
      return row;
    } catch (error) {
      logger.error(`Failed to get version ${id}`, error);
      throw error;
    }
  }

  async getOldestVersions(limit: number): Promise<VersionMetadata[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM versions
      ORDER BY createdAt ASC
      LIMIT ?
    `);

    try {
      const rows = stmt.all(limit) as VersionMetadata[];
      return rows;
    } catch (error) {
      logger.error('Failed to get oldest versions', error);
      throw error;
    }
  }

  async getTotalSize(): Promise<number> {
    const stmt = this.db.prepare('SELECT SUM(size) as total FROM versions');

    try {
      const row = stmt.get() as { total: number | null };
      return row.total || 0;
    } catch (error) {
      logger.error('Failed to get total versions size', error);
      throw error;
    }
  }

  close(): void {
    this.db.close();
    logger.info('SQLite metadata store closed');
  }
}
