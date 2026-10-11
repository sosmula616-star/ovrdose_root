/**
 * Middleware для защиты внутренних API взаимодействия с внешними ботами (Guard)
 */

function internalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.query.token;

  const validToken = process.env.INTERNAL_API_TOKEN;
  if (!validToken || token !== validToken) {
    return res.status(403).json({ error: 'Недействительный токен внутреннего API (INTERNAL_API_TOKEN)' });
  }

  next();
}

module.exports = { internalAuth };
