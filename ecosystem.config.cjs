const optimizelyTrainingDir = process.env.OPTIMIZELY_TRAINING_DIR || "/home/brand/OptimizelyTraining";
const optimizelyTrainingPort = process.env.OPTIMIZELY_TRAINING_PORT || "17820";

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
    },
    {
      name: "cms-smartling-web",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 17819",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      watch: false,
      time: true,
      env: {
        NODE_ENV: "production",
        BACKEND_TARGET: "http://127.0.0.1:17817"
      }
    },
    {
      name: "optimizely-training",
      cwd: optimizelyTrainingDir,
      script: "training-server.js",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      watch: false,
      time: true,
      env: {
        NODE_ENV: "production",
        TRAINING_PORT: optimizelyTrainingPort,
        TRAINING_BASE_PATH: "/optimizely-training"
      }
    }
  ]
};
