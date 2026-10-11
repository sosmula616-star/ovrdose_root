/**
 * PM2 Ecosystem Configuration for root-core
 * Manages root-core-root (Bot Root + Admin Panel in 1 process) and root-core-guard (external bot)
 */

module.exports = {
  apps: [
    {
      name: 'root-core-root',
      script: './apps/root/src/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './data/logs/pm2-root-error.log',
      out_file: './data/logs/pm2-root-out.log',
      time: true,
    },
    {
      name: 'root-core-guard',
      script: './apps/guard/src/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './data/logs/pm2-guard-error.log',
      out_file: './data/logs/pm2-guard-out.log',
      time: true,
    },
  ],
};
