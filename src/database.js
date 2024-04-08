import sqlite3 from 'sqlite3'
import { open } from 'sqlite'

/**
 * Opens a connection to the SQLite database.
 * @returns {Promise<import('sqlite').Database>} A promise that resolves with the database connection.
 */
export async function openDb() {
  return open({
    filename: './database.db',
    driver: sqlite3.Database,
  })
}

/**
 * Initializes the database by opening a connection and creating the `users` table if it doesn't exist.
 * @returns {Promise<import('sqlite').Database>} A promise that resolves with the database connection after ensuring the `users` table exists.
 */
export async function initDb() {
  const db = await open({
    filename: './database.db',
    driver: sqlite3.Database,
  })
  await db.exec(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY NOT NULL,
      username TEXT,
      code TEXT NOT NULL,
      date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  )
  return db
}

/**
 * Adds a new user to the database.
 * @param {import('sqlite').Database} db - The database connection.
 * @param {{ id: number, username: string, code: string }} User data.
 * @returns {Promise<void>} A promise that resolves when the user is added.
 */
export async function addUser(db, { id, username, code }) {
  const statement = await db.prepare(`
    INSERT INTO users (id, username, code) VALUES (?, ?, ?)
    ON CONFLICT(id) 
    DO UPDATE SET username = excluded.username, code = excluded.code, date = CURRENT_TIMESTAMP
  `)
  await statement.run(id, username, code)
  await statement.finalize()
}

/**
 * Retrieves all users from the database.
 * @param {import('sqlite').Database} db - The database connection.
 * @returns {Promise<Array>} A promise that resolves with an array of users.
 */
export async function getUsers(db) {
  const rows = await db.all('SELECT * FROM users ORDER BY date ASC')
  return rows
}
