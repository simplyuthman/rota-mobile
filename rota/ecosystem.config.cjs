// PM2 Ecosystem Config — Rota Production
// Usage:
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup

module.exports = {
  apps: [
    {
      // ── API Server ────────────────────────────────────────────────────────────
      name: 'rota-api',
      script: './services/api/dist/server.js',
      instances: 1,           // increase to 'max' on multi-core servers
      exec_mode: 'fork',      // use 'cluster' if instances > 1
      node_args: '--max-old-space-size=512',
      env_production: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3000,
      },
      // Restart on crash, not on memory limit breach
      max_restarts: 10,
      restart_delay: 3000,
      // Logs
      out_file: './logs/api-out.log',
      error_file: './logs/api-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      // ── BullMQ Notification Worker ────────────────────────────────────────────
      name: 'rota-worker',
      script: './services/api/dist/jobs/index.js',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=256',
      env_production: {
        NODE_ENV: 'production',
      },
      max_restarts: 10,
      restart_delay: 5000,
      out_file: './logs/worker-out.log',
      error_file: './logs/worker-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
