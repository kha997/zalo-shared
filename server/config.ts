export interface Config {
  host: string;
  port: number;
  publicOrigin: string;
  mockEnabled: boolean;
  secureCookie: boolean;
  metricsToken: string;
  loginRateLimit: number;
}
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const host = env.HOST || "127.0.0.1";
  const publicOrigin = env.PUBLIC_ORIGIN || "http://127.0.0.1:3100";
  const u = new URL(publicOrigin);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    u.username ||
    u.password
  )
    throw new Error("Invalid PUBLIC_ORIGIN");
  if (
    u.protocol === "http:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
  )
    throw new Error("HTTP requires loopback PUBLIC_ORIGIN");
  if (env.PROVIDER_MODE && !["mock", "disabled"].includes(env.PROVIDER_MODE))
    throw new Error("Live provider is unavailable");
  if (env.NODE_ENV === "production" && env.MOCK_ENABLED === "true")
    throw new Error("Mock controls forbidden in production");
  const port = Number(env.PORT || 3100),
    loginRateLimit = Number(env.LOGIN_RATE_LIMIT || 10);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isInteger(loginRateLimit) ||
    loginRateLimit < 1 ||
    loginRateLimit > 10000
  )
    throw new Error("Invalid numeric configuration");
  return {
    host,
    port,
    publicOrigin: u.origin,
    mockEnabled:
      env.MOCK_ENABLED === "true" && env.PROVIDER_MODE !== "disabled",
    secureCookie: u.protocol === "https:",
    metricsToken: env.METRICS_TOKEN || "",
    loginRateLimit,
  };
}
