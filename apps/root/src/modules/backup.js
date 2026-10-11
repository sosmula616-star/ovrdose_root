/**
 * Модуль резервного копирования базы данных (автобэкапы, ротация, восстановление)
 */

const path = require('path');
const fs = require('fs');
const { getDb, closeDatabase, initDatabase, system: systemRepo } = require('@root-core/db');

class BackupModule {
  constructor(client, logger, loggingModule) {
    this.client = client;
    this.logger = logger;
    this.loggingModule = loggingModule;

    this.backupDir = path.resolve('./data/backups');
    this.maxBackups = 10;
    this.autoBackupTimer = null;

    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  init() {
    this.logger.info('[Backup] Модуль бэкапов инициализирован');
    // Автоматический бэкап каждые 6 часов
    this.autoBackupTimer = setInterval(() => {
      this.createBackup('Автоматический бэкап по расписанию', 'system').catch(err => {
        this.logger.error(`[Backup] Ошибка планового бэкапа: ${err.message}`);
      });
    }, 6 * 60 * 60 * 1000);
  }

  destroy() {
    if (this.autoBackupTimer) {
      clearInterval(this.autoBackupTimer);
      this.autoBackupTimer = null;
    }
  }

  /**
   * Создание нового бэкапа базы данных
   */
  async createBackup(notes = 'Ручной бэкап', createdBy = 'admin') {
    const db = getDb();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_${timestamp}.db`;
    const targetPath = path.join(this.backupDir, filename);

    // Нативный snapshot better-sqlite3 в WAL-режиме
    await db.backup(targetPath);

    const stats = fs.statSync(targetPath);
    systemRepo.addBackupRecord(filename, stats.size, createdBy, notes);

    this.logger.info(`[Backup] Создан бэкап: ${filename} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    this.rotate();

    return { filename, sizeBytes: stats.size };
  }

  /**
   * Ротация старых бэкапов
   */
  rotate() {
    const files = fs.readdirSync(this.backupDir)
      .filter(f => f.startsWith('backup_') && f.endsWith('.db'))
      .sort()
      .reverse();

    if (files.length > this.maxBackups) {
      const toDelete = files.slice(this.maxBackups);
      for (const f of toDelete) {
        try {
          fs.unlinkSync(path.join(this.backupDir, f));
          systemRepo.deleteBackupRecord(f);
          this.logger.info(`[Backup] Удален старый бэкап по ротации: ${f}`);
        } catch (e) {}
      }
    }
  }

  /**
   * Список всех бэкапов
   */
  getBackups() {
    return systemRepo.getBackups();
  }

  /**
   * Восстановление базы данных из бэкапа (только Owner)
   */
  async restore(filename, requestedBy = 'owner') {
    const safeName = path.basename(filename);
    const sourcePath = path.join(this.backupDir, safeName);
    const mainDbPath = path.resolve(process.env.DB_PATH || './data/shared.db');

    if (!fs.existsSync(sourcePath)) {
      throw new Error('Файл бэкапа не найден на сервере');
    }

    this.logger.warn(`[Backup] ВНИМАНИЕ: Запущено восстановление базы из ${safeName} пользователем ${requestedBy}`);

    // Создаем предварительную аварийную копию текущей БД перед накатом
    const preRestoreName = `pre_restore_${Date.now()}.db`;
    const preRestorePath = path.join(this.backupDir, preRestoreName);

    const db = getDb();
    await db.backup(preRestorePath);

    // Закрываем соединение перед заменой файла
    closeDatabase();

    // Заменяем файл БД
    fs.copyFileSync(sourcePath, mainDbPath);

    // Переинициализируем соединение
    initDatabase(mainDbPath);

    this.logger.info(`[Backup] База данных успешно восстановлена из ${safeName}`);
    return { ok: true, restoredFrom: safeName, safetyBackup: preRestoreName };
  }

  /**
   * Удаление файла бэкапа
   */
  deleteBackup(filename) {
    const safeName = path.basename(filename);
    const p = path.join(this.backupDir, safeName);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
    systemRepo.deleteBackupRecord(safeName);
    return { ok: true };
  }
}

module.exports = BackupModule;
