import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sharp", "bullmq", "ioredis", "@anthropic-ai/sdk"],
};

export default nextConfig;
