/**
 * Middleware аутентификации и авторизации веб-панели (RBAC: owner, admin, viewer)
 */

const { system: systemRepo } = require('@root-core/db');

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав для выполнения операции' });
    }
    next();
  };
}

function canView(req, res, next) {
  return requireRole('owner', 'admin', 'viewer')(req, res, next);
}

function canEdit(req, res, next) {
  return requireRole('owner', 'admin')(req, res, next);
}

function ownerOnly(req, res, next) {
  return requireRole('owner')(req, res, next);
}

function loadUser(req, res, next) {
  if (!req.session?.user) return next();

  try {
    const user = systemRepo.getPanelUser(req.session.user.discord_id);
    if (!user) {
      req.session.destroy(() => {});
      return res.redirect('/auth/login?error=access_revoked');
    }

    req.user = user;
    req.session.user.role = user.role;
    res.locals.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  requireAuth,
  requireRole,
  canView,
  canEdit,
  ownerOnly,
  loadUser,
};
