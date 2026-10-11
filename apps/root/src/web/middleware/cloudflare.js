/**
 * Cloudflare Bot Protection & Turnstile Validator Middleware
 * Проверяет заголовки Cloudflare, фильтрует ботнет-сканеры и валидирует капчу Turnstile
 */

const fetch = globalThis.fetch || ((...args) => import('node-fetch').then(({default: f}) => f(...args)));

// Список нежелательных ботов, сканеров и уязвимостей
const BLOCKED_BOT_AGENTS = [
  /sqlmap/i,
  /nikto/i,
  /masscan/i,
  /zgrab/i,
  /dirbuster/i,
  /gobuster/i,
  /wpscan/i,
  /nmap/i,
  /acunetix/i,
];

/**
 * Middleware фильтрации вредоносных ботов и извлечения Cloudflare IP
 */
function cloudflareSecurity(req, res, next) {
  // 1. Извлечение реального IP от Cloudflare
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) {
    req.realIp = cfIp;
  } else {
    req.realIp = req.ip;
  }

  // 2. Блокировка сигнатур вредоносных автоматизированных сканеров
  const ua = req.headers['user-agent'] || '';
  for (const pattern of BLOCKED_BOT_AGENTS) {
    if (pattern.test(ua)) {
      return res.status(403).json({ error: 'Access denied: Automated security scanner blocked by Cloudflare shield' });
    }
  }

  next();
}

/**
 * Валидация Cloudflare Turnstile токена через API Cloudflare
 * @param {string} token - Токен 'cf-turnstile-response' из формы
 * @param {string} remoteIp - IP адрес клиента
 * @returns {Promise<boolean>}
 */
async function verifyTurnstile(token, remoteIp) {
  const secretKey = process.env.CF_TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';

  // Если Turnstile отключен в .env, пропускаем
  if (process.env.CF_TURNSTILE_ENABLED === 'false') {
    return true;
  }

  if (!token) return false;

  try {
    const formData = new URLSearchParams({
      secret:   secretKey,
      response: token,
      remoteip: remoteIp || '',
    });

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!res.ok) return false;
    const outcome = await res.json();
    return outcome.success === true;
  } catch (err) {
    console.error('[Cloudflare Turnstile] Ошибка верификации:', err.message);
    // При сбое связи с Cloudflare разрешаем доступ если режим dummy
    return secretKey.startsWith('1x000000');
  }
}

module.exports = {
  cloudflareSecurity,
  verifyTurnstile,
};
