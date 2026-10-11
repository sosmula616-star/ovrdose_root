/**
 * Маршруты Discord OAuth2 аутентификации
 */

const router = require('express').Router();
const fetch = require('node-fetch');
const { system: systemRepo } = require('@root-core/db');
const { recordAudit } = require('../middleware/audit');

const DISCORD_API = 'https://discord.com/api/v10';

router.get('/login', (req, res) => {
  const params = new URLSearchParams({
    client_id:     process.env.DISCORD_CLIENT_ID_ROOT,
    redirect_uri:  `${process.env.PANEL_BASE_URL || 'http://127.0.0.1:3000'}/auth/callback`,
    response_type: 'code',
    scope:         'identify',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/auth/login?error=cancelled');

  try {
    // Обмен кода на токен
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id:     process.env.DISCORD_CLIENT_ID_ROOT,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code:          code,
        redirect_uri:  `${process.env.PANEL_BASE_URL || 'http://127.0.0.1:3000'}/auth/callback`,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!tokenRes.ok) throw new Error('OAuth2 token exchange failed');
    const tokenData = await tokenRes.json();

    // Профиль пользователя
    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) throw new Error('Failed to fetch user profile');
    const discordUser = await userRes.json();

    // Проверка белого списка в panel_users
    const panelUser = systemRepo.getPanelUser(discordUser.id);
    if (!panelUser) {
      return res.status(403).send(`
        <!DOCTYPE html>
        <html lang="ru">
        <head><meta charset="utf-8"><title>Доступ запрещен</title>
        <style>body{background:#0B0D10;color:#E6E8EB;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}</style>
        </head>
        <body>
          <div style="background:#12151A;border:1px solid #232830;padding:32px;border-radius:6px;max-width:400px;text-align:center;">
            <h2 style="color:#C9545D;margin-top:0;">Доступ запрещен (403)</h2>
            <p style="color:#8B93A1;font-size:14px;">Ваш аккаунт Discord (${discordUser.username}) не внесен в белый список администраторов панели.</p>
            <a href="/auth/login" style="display:inline-block;margin-top:16px;color:#C8A96A;text-decoration:none;font-weight:600;">Повторить попытку</a>
          </div>
        </body>
        </html>
      `);
    }

    // Обновляем данные пользователя в БД
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

    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(returnTo);
  } catch (err) {
    console.error('OAuth Callback Error:', err);
    res.redirect('/auth/login?error=server_error');
  }
});

router.post('/logout', (req, res) => {
  recordAudit(req, 'Выход из панели управления', 'auth');
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/auth/login');
  });
});

module.exports = router;
