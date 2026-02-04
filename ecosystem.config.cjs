module.exports = {
  apps: [
    {
      name: "api-service",
      script: "dist/api.js", // Use built file
      interpreter: "bun", // Use Bun interpreter
      env: {
        NODE_ENV: "production",
        API_PORT: 4000,
      },
    },
    {
      name: "payment-service",
      script: "dist/payment.js", // Use built file
      interpreter: "bun",
      env: {
        NODE_ENV: "production",
        PAYMENT_PORT: 3001,
      },
    },
    // {
    //   name: "worker-service",
    //   script: "src/instances/worker.ts",
    //   interpreter: "bun",
    //   env: {
    //     NODE_ENV: "production",
    //   },
    // },
  ],
};
