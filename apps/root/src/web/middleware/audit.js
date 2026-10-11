/**
 * Middleware и утилита записи в журнал аудита веб-панели (с рассылкой SSE)
 */

const { system: systemRepo } = require('@root-core/db');

function recordAudit(req, action, section, opts = {}) {
  try {
    const user = req.session?.user || req.user;
    const adminId = user?.discord_id || 'system';
    const adminTag = user?.discord_tag || 'System';

    systemRepo.addAudit(
      adminId,
      adminTag,
      action,
      section || null,
      opts.targetId ? String(opts.targetId) : null,
      opts.oldValue != null ? opts.oldValue : null,
      opts.newValue != null ? opts.newValue : null,
      req.ip || null
    );

    // Рассылка живого события через SSE (если подключены клиенты)
    if (req.app?.locals?.broadcastEvent) {
      req.app.locals.broadcastEvent('audit:new', {
        adminTag,
        action,
        section,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('Ошибка записи аудита:', err.message);
  }
}

function auditAction(action, section) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        recordAudit(req, action, section, {
          targetId: req.params?.id || req.params?.discordId || req.params?.filename || req.body?.guildId,
          newValue: req.body,
        });
      }
    });
    next();
  };
}

module.exports = { recordAudit, auditAction };
