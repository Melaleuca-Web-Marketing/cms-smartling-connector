module.exports = {
  apps: [
    {
      name: "cms-smartling-connector",
      cwd: __dirname,
      script: "backend/server.mjs",
      interpreter: "node",
      node_args: "--no-warnings=ExperimentalWarning --env-file=.env",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      watch: false,
      time: true,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
