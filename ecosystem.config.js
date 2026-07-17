module.exports = {
  apps: [
    {
      name: "prospector-frontend",
      cwd: __dirname,
      script: "npm",
      args: "start",
    },
    {
      name: "prospector-backend",
      cwd: __dirname + "/server",
      script: "npm",
      args: "run dev",
    },
  ],
};
