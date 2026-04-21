module.exports = {
  apps: [
    {
      name: "evidence-api",
      script: "pnpm",
      args: "-F @blockurna/evidence-api run start",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "evidence-indexer",
      script: "pnpm",
      args: "-F @blockurna/evidence-indexer run start",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "mrd-relayer",
      script: "pnpm",
      args: "-F @blockurna/mrd-relayer run start",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
