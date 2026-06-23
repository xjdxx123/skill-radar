import Database from 'better-sqlite3';
import { SCHEMA } from './schema';

export type Db = Database.Database;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
