const DEFAULT_SOS_KEYWORDS = 'sos,help,emergency,danger,unsafe,bachao';

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3000,
    dbPath: env.DB_PATH || 'data/safety.db',
    trustProxy: env.TRUST_PROXY === 'true',
    dashboardPassword: env.DASHBOARD_PASSWORD || '',
    sessionSecret: env.SESSION_SECRET || '',
    sessionHours: Number(env.SESSION_HOURS) || 12,
    meta: {
      verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
      appSecret: env.WHATSAPP_APP_SECRET || '',
      accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
      graphVersion: env.WHATSAPP_GRAPH_VERSION || 'v21.0',
    },
    twilio: {
      authToken: env.TWILIO_AUTH_TOKEN || '',
      publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    },
    emergencyNumber: env.EMERGENCY_NUMBER || '112',
    sosKeywords: (env.SOS_KEYWORDS || DEFAULT_SOS_KEYWORDS)
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean),
    retentionDays: Number(env.RETENTION_DAYS) || 30,
    staleMinutes: Number(env.STALE_MINUTES) || 15,
    maxSnapshotPoints: Number(env.MAX_SNAPSHOT_POINTS) || 20000,
    tileUrl: env.TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileAttribution:
      env.TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };
}
