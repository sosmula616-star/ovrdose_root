/**
 * Маршруты Discord OAuth2 аутентификации
 */

const router = require('express').Router();
const fetch = globalThis.fetch || ((...args) => import('node-fetch').then(({default: f}) => f(...args)));
const { system: systemRepo } = require('@root-core/db');
const { recordAudit } = require('../middleware/audit');

const DISCORD_API = 'https://discord.com/api/v10';

router.get('/login', (req, res) => {
  const { error } = req.query;

  // Если произошла ошибка авторизации, не уходим в бесконечный цикл, а показываем страницу
  if (error) {
    const errorMessages = {
      cancelled: 'Авторизация была отменена пользователем.',
      server_error: 'Внутренняя ошибка при связи с Discord API.',
      access_revoked: 'Доступ был отозван администратором.',
      no_secret: 'В конфигурации .env не указан DISCORD_CLIENT_SECRET бота.',
    };

    return res.status(401).send(`
      <!DOCTYPE html>
      <html lang="ru">
      <head><meta charset="utf-8"><title>Вход в панель Root</title>
      <style>
        body { background: #0B0D10; color: #E6E8EB; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #12151A; border: 1px solid #232830; padding: 32px; border-radius: 6px; max-width: 420px; text-align: center; }
        .btn { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #C8A96A; color: #0B0D10; font-weight: 600; text-decoration: none; border-radius: 6px; }
        .error { color: #C9545D; font-size: 13px; margin-top: 12px; }
      </style>
      </head>
      <body>
        <div class="card">
          <h2 style="margin-top:0; letter-spacing: 0.1em; font-family: monospace;">ROOT MANAGEMENT CONSOLE</h2>
          <p style="color: #8B93A1; font-size: 14px;">Для доступа к консоли управления войдите под своим Discord-аккаунтом.</p>
          <div class="error">${errorMessages[error] || 'Ошибка авторизации: ' + error}</div>
          <a href="/auth/login" class="btn">Войти через Discord</a>
        </div>
      </body>
      </html>
    `);
  }

  // Проверяем наличие Client Secret
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
});

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
            <p style="color:#8B93A1;font-size:14px;">Discord вернул ошибку при обмене кода авторизации:<br><code style="color:#E6E8EB;background:#181C22;padding:4px 8px;border-radius:4px;display:inline-block;margin-top:8px;">${errText}</code></p>
            <p style="color:#8B93A1;font-size:12px;margin-top:12px;">Проверьте значение <code>DISCORD_CLIENT_SECRET</code> на хостинге Bothost и наличие Redirect URI <code>${redirectUri}</code> в Discord Developer Portal.</p>
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
