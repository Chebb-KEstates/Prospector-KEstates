module.exports = {
  apps: [
    {
      name: 'prospector-frontend',
      cwd: __dirname,
      script: 'npm',
      args: 'start',
      env: {
        PORT: process.env.WEB_PORT || 3023,
      },
    },
    {
      name: 'prospector-backend',
      cwd: __dirname + '/server',
      script: 'npm',
      args: 'start',
      env: {
        PORT: process.env.SERVER_PORT || 4023,
      },
    },
  ],
};
