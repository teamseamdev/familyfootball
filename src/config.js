import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(overrides = {}) {
  const defaults = JSON.parse(fs.readFileSync(path.join(rootDir, 'config', 'default.json'), 'utf8'));
  const localPath = path.join(rootDir, 'config', 'local.json');
  const local = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')) : {};
  const env = {
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    baseUrl: process.env.POOL_BASE_URL,
    timeZone: process.env.POOL_TIME_ZONE,
    adminKey: process.env.POOL_ADMIN_KEY,
    cronSecret: process.env.CRON_SECRET,
    storageProvider: process.env.POOL_STORAGE_PROVIDER,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    scheduleProvider: process.env.POOL_SCHEDULE_PROVIDER,
    fallbackProvider: process.env.POOL_FALLBACK_PROVIDER,
    scoreRefreshMinutes: process.env.POOL_SCORE_REFRESH_MINUTES ? Number(process.env.POOL_SCORE_REFRESH_MINUTES) : undefined,
    simulationEnabled: process.env.POOL_SIMULATION_ENABLED === 'true' ? true : undefined,
    smsProvider: process.env.POOL_SMS_PROVIDER,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    twilioFrom: process.env.TWILIO_FROM,
    smsTo: process.env.POOL_SMS_TO
  };
  const cleanEnv = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
  return {
    ...defaults,
    ...local,
    ...cleanEnv,
    ...overrides,
    rootDir,
    dataFile: overrides.dataFile || path.join(rootDir, 'data', 'pool.json')
  };
}

export { rootDir };
