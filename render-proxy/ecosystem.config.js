module.exports = {
  apps: [{
    name: 'rss-render-proxy',
    script: 'index.js',
    env: {
      PORT: 3456,
      API_KEY: 'change-me-to-a-random-string',
    },
    max_memory_restart: '500M',
    max_restarts: 10,
    restart_delay: 5000,
  }],
};
