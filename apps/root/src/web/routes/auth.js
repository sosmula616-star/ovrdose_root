/**
 * Маршруты Discord OAuth2 аутентификации с защитой Cloudflare Turnstile
 */

const router = require('express').Router();
const fetch = globalThis.fetch || ((...args) => import('node-fetch').then(({default: f}) => f(...args)));
const { system: systemRepo } = require('@root-core/db');
const { recordAudit } = require('../middleware/audit');
const { verifyTurnstile } = require('../middleware/cloudflare');

const DISCORD_API = 'https://discord.com/api/v10';

// Страница проверки Cloudflare и входа в консоль
router.get('/login', (req, res) => {
  const { error } = req.query;

  // Если Turnstile отключен в .env, сразу отправляем на Discord OAuth
  if (process.env.CF_TURNSTILE_ENABLED === 'false') {
    return redirectToDiscord(req, res);
  }

  const siteKey = process.env.CF_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

  const errorMessages = {
    cancelled: 'Авторизация была отменена пользователем.',
    server_error: 'Внутренняя ошибка при связи с Discord API.',
    access_revoked: 'Доступ был отозван администратором.',
    no_secret: 'В конфигурации хостинга не указан DISCORD_CLIENT_SECRET.',
    bot_detected: 'Проверка Cloudflare не пройдена (подозрение на бота).',
  };

  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cloudflare Shield | Вход в Root Console</title>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
      <style>
        body { background: #0B0D10; color: #E6E8EB; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; box-sizing: border-box; }
        .card { background: #12151A; border: 1px solid #232830; padding: 36px; border-radius: 6px; width: 440px; max-width: 100%; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.4); }
        .logo { font-family: ui-monospace, Consolas, monospace; font-size: 18px; font-weight: 600; letter-spacing: 0.2em; color: #C8A96A; margin-bottom: 6px; }
        .subtitle { color: #8B93A1; font-size: 13px; margin-bottom: 24px; line-height: 1.5; }
        .turnstile-box { display: flex; justify-content: center; margin: 20px 0; min-height: 65px; }
        .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 42px; background: #C8A96A; color: #0B0D10; font-weight: 600; font-size: 14px; text-decoration: none; border-radius: 6px; border: none; cursor: pointer; transition: opacity 0.2s, background-color 0.2s; }
        .btn:hover:not(:disabled) { background: #D8BC82; }
        .btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .error-msg { background: rgba(201, 84, 93, 0.12); border: 1px solid #C9545D; color: #C9545D; padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 18px; text-align: left; }
        .shield-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #8B93A1; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">ROOT CONSOLE</div>
        <div class="subtitle">Инфраструктура защищена Cloudflare Bot Shield.<br>Подтвердите, что вы человек, для продолжения.</div>

        ${error ? `<div class="error-msg">${errorMessages[error] || 'Ошибка: ' + error}</div>` : ''}

        <form method="POST" action="/auth/verify">
          <div class="turnstile-box">
            <div class="cf-turnstile" data-sitekey="${siteKey}" data-callback="onTurnstileSuccess" data-theme="dark"></div>
          </div>
          <button type="submit" id="loginBtn" class="btn" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
            Войти через Discord
          </button>
        </form>

        <div class="shield-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Cloudflare Turnstile Verified Protection
        </div>
      </div>

      <script>
        function onTurnstileSuccess(token) {
          document.getElementById('loginBtn').disabled = false;
        }
      </script>
    </body>
    </html>
  `);
});

// Проверка Turnstile и перенаправление в Discord
router.post('/verify', async (req, res) => {
  const token = req.body['cf-turnstile-response'];
  const isValid = await verifyTurnstile(token, req.realIp);

  if (!isValid) {
    return res.redirect('/auth/login?error=bot_detected');
  }

  req.session.cfPassed = true;
  req.session.save(() => {
    redirectToDiscord(req, res);
  });
});

function redirectToDiscord(req, res) {
  if (!process.env.DISCORD_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET.includes('ваш_client_secret')) {
    return res.redirect('/auth/login?error=no_secret');
  }

  const redirectUri = `${process.env.PANEL_BASE_URL || 'http://127.0.0.1:3000'}/auth/callback`;
  const params = new URLSearchParams({
    client_id:     process.env.DISCORD_CLIENT_ID_ROOT,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'identify',
    prompt:        'consent',
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
}

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect('/auth/login?error=cancelled');
  }

  const redirectUri = `${process.env.PANEL_BASE_URL || 'http://127.0.0.1:3000'}/auth/callback`;

  try {
    // 1. Обмен кода авторизации на токен доступа Discord
    const tokenParams = new URLSearchParams({
      client_id:     process.env.DISCORD_CLIENT_ID_ROOT,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type:    'authorization_code',
      code:          code,
      redirect_uri:  redirectUri,
    });

    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      body: tokenParams,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[OAuth2 Error] Ошибка обмена токена Discord:', errText);
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="ru"><head><meta charset="utf-8"><title>Ошибка Discord OAuth2</title>
        <style>body{background:#0B0D10;color:#E6E8EB;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}</style>
        </head><body>
          <div style="background:#12151A;border:1px solid #232830;padding:32px;border-radius:6px;max-width:440px;text-align:center;">
            <h2 style="color:#C9545D;">Ошибка OAuth2</h2>
            <p style="color:#8B93A1;font-size:14px;">Discord отклонил авторизацию:<br><code style="color:#E6E8EB;background:#181C22;padding:4px 8px;border-radius:4px;display:inline-block;margin-top:8px;">${errText}</code></p>
            <p style="color:#8B93A1;font-size:12px;margin-top:12px;">Проверьте, что в настройках хостинга указан верный <code>DISCORD_CLIENT_SECRET</code>, а в Discord Portal добавлен Redirect <code>${redirectUri}</code>.</p>
            <a href="/auth/login" style="display:inline-block;margin-top:16px;color:#C8A96A;text-decoration:none;font-weight:600;">Попробовать снова</a>
          </div>
        </body></html>
      `);
    }

    const tokenData = await tokenRes.json();

    // 2. Получение профиля пользователя
    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) throw new Error('Не удалось получить профиль пользователя от Discord API');
    const discordUser = await userRes.json();

    // 3. Проверка белого списка в panel_users
    const panelUser = systemRepo.getPanelUser(discordUser.id);
    if (!panelUser) {
      return res.status(403).send(`
        <!DOCTYPE html>
        <html lang="ru">
        <head><meta charset="utf-8"><title>Доступ запрещен</title>
        <style>body{background:#0B0D10;color:#E6E8EB;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}</style>
        </head>
        <body>
          <div style="background:#12151A;border:1px solid #232830;padding:32px;border-radius:6px;max-width:420px;text-align:center;">
            <h2 style="color:#C9545D;margin-top:0;">Доступ запрещен (403)</h2>
            <p style="color:#8B93A1;font-size:14px;">Ваш аккаунт Discord <b>${discordUser.username}</b> (ID: <code>${discordUser.id}</code>) не найден в списке администраторов панели.</p>
            <p style="color:#8B93A1;font-size:12px;">Убедитесь, что ваш Discord ID добавлен в переменную <code>OWNER_IDS</code> в .env.</p>
            <a href="/auth/login" style="display:inline-block;margin-top:16px;color:#C8A96A;text-decoration:none;font-weight:600;">Повторить попытку</a>
          </div>
        </body>
        </html>
      `);
    }

    // 4. Обновляем данные пользователя в БД
    const tag = `${discordUser.username}${discordUser.discriminator && discordUser.discriminator !== '0' ? '#' + discordUser.discriminator : ''}`;
    systemRepo.updatePanelUser(discordUser.id, {
      discordTag: tag,
      avatar: discordUser.avatar,
      lastLogin: new Date().toISOString(),
    });

    req.session.user = {
      discord_id:  discordUser.id,
      discord_tag: tag,
      avatar:      discordUser.avatar,
      role:        panelUser.role,
    };

    recordAudit(req, 'Вход в панель управления', 'auth');

    // 5. Сохраняем сессию в SQLite ПЕРЕД выполнением редиректа
    req.session.save((saveErr) => {
      if (saveErr) console.error('Ошибка сохранения сессии:', saveErr);
      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  } catch (err) {
    console.error('OAuth Callback Exception:', err);
    res.redirect('/auth/login?error=server_error');
  }
});

router.get('/me', (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  res.json(req.session.user);
});

router.post('/logout', (req, res) => {
  recordAudit(req, 'Выход из панели управления', 'auth');
  req.session.destroy(() => {
    res.clearCookie('root_session');
    res.redirect('/auth/login');
  });
});

router.get('/logout', (req, res) => {
  recordAudit(req, 'Выход из панели управления', 'auth');
  req.session.destroy(() => {
    res.clearCookie('root_session');
    res.redirect('/auth/login');
  });
});

module.exports = router;
