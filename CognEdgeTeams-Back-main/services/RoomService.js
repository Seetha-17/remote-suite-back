import { openDb } from '../db.js';

export async function getRooms() {
  const db = await openDb();
  return db.all('SELECT DISTINCT roomId as id FROM messages');
}
