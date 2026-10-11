/**
 * Скрипт создания бэкапа SQLite базы данных с ротацией
 * Запуск: npm run backup
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { initDatabase, getDb, closeDatabase } = require('../packages/db/src/index');

const dbPath = process.env.DB_PATH || './data/shared.db';
const backupDir = path.resolve('./data/backups');
const MAX_BACKUPS = 10;

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

async function runBackup() {
  const db = initDatabase(dbPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup_${timestamp}.db`;
  const destPath = path.join(backupDir, filename);

  console.log(`[Backup] Создание снапшота базы данных в ${destPath}...`);

  // Используем нативный метод .backup() better-sqlite3 в WAL-режиме
  await db.backup(destPath);

  const stats = fs.statSync(destPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

  db.prepare(`
    INSERT INTO backups (filename, size_bytes, created_by, notes)
    VALUES (?, ?, 'cli_script', 'Автоматический бэкап системы')
  `).run(filename, stats.size);

  console.log(`[Backup] Бэкап создан успешно (${sizeMb} MB).`);

  // Ротация: удаляем старые бэкапы, превышающие MAX_BACKUPS
  const allBackups = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('backup_') && f.endsWith('.db'))
    .sort()
    .reverse();

  if (allBackups.length > MAX_BACKUPS) {
    const toDelete = allBackups.slice(MAX_BACKUPS);
    for (const f of toDelete) {
      const p = path.join(backupDir, f);
      try {
        fs.unlinkSync(p);
        db.prepare('DELETE FROM backups WHERE filename = ?').run(f);
        console.log(`[Backup] Удален старый бэкап по ротации: ${f}`);
      } catch (e) {}
    }
  }

  closeDatabase();
}

runBackup().catch(err => {
  console.error('[Backup] Критическая ошибка:', err);
  process.exit(1);
});
