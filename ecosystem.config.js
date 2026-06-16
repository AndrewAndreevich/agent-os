module.exports = {
  apps: [
    {
      name: 'agentOS-server',
      script: './server/index.js',
      watch: false,
      restart_delay: 3000,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'agentOS-client',
      script: './client/index.js',
      watch: false,
      restart_delay: 5000,
      env: { NODE_ENV: 'production' }
    }
  ]
};
