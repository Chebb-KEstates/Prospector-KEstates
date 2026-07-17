module.exports = {
  apps: [
    {
      name: "frontend",
      cwd: __dirname,
      script: "npm",
      args: "start",
    },
    {
      name: "backend",
      cwd: __dirname + "/server",
      script: "npm",
      args: "run dev",
    },
  ],
};
