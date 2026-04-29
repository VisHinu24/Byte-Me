import 'dotenv/config';

const required = (key, fallback) => {
  const v = process.env[key] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
};

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongoUri: required('MONGO_URI'),
  jwtSecret: required('JWT_SECRET', 'dev-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  groqApiKey: process.env.GROQ_API_KEY ?? '',
  // Comma-separated list of allowed CORS origins (production hardening).
  // When unset, CORS is permissive (dev). Set to e.g. "https://pml.vercel.app".
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? null,
};

export const isDev = env.nodeEnv === 'development';
