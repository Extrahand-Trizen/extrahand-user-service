import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Define environment schema
const mongoUriSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  },
  z.string().regex(/^mongodb(\+srv)?:\/\//, 'Invalid MongoDB URI')
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).refine(n => n > 0 && n < 65536, 'Port must be between 1-65535').default('4001'),
  
  // MongoDB
  MONGODB_URI: mongoUriSchema.optional(),
  MONGODB_DB: z.string().default('extrahand'),
  
  // Firebase
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  FIREBASE_WEB_API_KEY: z.string().optional(),
  FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
  
  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  
  // Security
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('1000'),
  ACCESS_TOKEN_SECRET: z.string().min(32, 'ACCESS_TOKEN_SECRET must be at least 32 characters'),
  REFRESH_TOKEN_SECRET: z.string().min(32, 'REFRESH_TOKEN_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().min(1).max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().min(1).max(90).default(30),
  REFRESH_TOKEN_COOKIE_NAME: z.string().default('eh_refresh_token'),
  ACCESS_TOKEN_COOKIE_NAME: z.string().default('accessToken'),
  SESSION_COOKIE_DOMAIN: z.string().optional(),
  
  // CORS
  CORS_ORIGIN: z.string().optional(),
  
  // Health check
  HEALTH_CHECK_PATH: z.string().default('/api/v1/health'),
  
  // Service-to-Service Communication
  SERVICE_AUTH_TOKEN: z.string().min(1, 'SERVICE_AUTH_TOKEN is required for service-to-service communication').optional(),
  TASK_SERVICE_URL: z.string().url().default('http://localhost:4002'),
  PAYMENT_SERVICE_URL: z.string().url().default('http://localhost:4009'),
  MESSAGING_SERVICE_URL: z.string().url().default('http://localhost:4006'),
  VERIFICATION_SERVICE_URL: z.string().url().default('http://localhost:4004'),
  
  // Storage Configuration
  STORAGE_PROVIDER: z.enum(['minio', 's3']).default('minio'),

  WEB_APP_URL: z.string().url().default('https://extrahand.in'),

  // Dev-only: when true, allow dummy signin/signup with fixed Indian number + OTP (no reCAPTCHA)
  LOCAL_TEST: z.string().optional().transform((v) => v === "true" || v === "1"),

  /** Comma-separated Firebase UIDs: GET /profiles/me returns fully verified flags (no DB write). */
  PLAY_REVIEW_BYPASS_UIDS: z.string().optional(),
  /** Comma-separated phones (+91… or 10 digits); same effect as UIDs when profile.phone matches. */
  PLAY_REVIEW_BYPASS_PHONES: z.string().optional(),

  // MinIO Configuration
  MINIO_ENDPOINT: z.string().optional(),
  MINIO_PORT: z.string().optional(),
  MINIO_USE_SSL: z.string().optional(),
  MINIO_ACCESS_KEY: z.string().optional(),
  MINIO_SECRET_KEY: z.string().optional(),
  MINIO_ROOT_USER: z.string().optional(),
  MINIO_ROOT_PASSWORD: z.string().optional(),
  MINIO_BUCKET_NAME: z.string().default('extrahand-images'),
  MINIO_PUBLIC_DOMAIN: z.string().optional(),
  MINIO_SERVER_URL: z.string().url().optional(),
  MINIO_REGION_NAME: z.string().optional(),
  
  // AWS S3 Configuration
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET_NAME: z.string().default('extrahand-images'),
  AWS_CLOUDFRONT_DOMAIN: z.string().optional(),

  // MyOperator contact creation (optional; only used during signup)
  MYOPERATOR_CONTACTS_URL: z.string().url().default('https://publicapi.myoperator.co/contacts'),
  MYOPERATOR_BEARER_TOKEN: z.string().optional(),
  MYOPERATOR_COMPANY_ID: z.string().optional(),
  MYOPERATOR_COUNTRY_CODE: z.string().default('91'),
  /** POST /chat/messages — WhatsApp template (same host as public API by default). */
  MYOPERATOR_CHAT_MESSAGES_URL: z.string().url().default('https://publicapi.myoperator.co/chat/messages'),
  /** WhatsApp Business phone_number_id (required to send signup template). */
  MYOPERATOR_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  MYOPERATOR_SIGNUP_WA_TEMPLATE_NAME: z
    .string()
    .default('copy_copy_extrahand_existing_taskerdata_campaign'),
  MYOPERATOR_SIGNUP_WA_LANGUAGE: z.string().default('en'),
});

// Extend global type for CORS config logging
declare global {
  // eslint-disable-next-line no-var
  var __CORS_CONFIG_LOGGED__: boolean | undefined;
}

// CORS configuration
export function getCorsConfig(env: z.infer<typeof envSchema>) {
  const allowedOrigins = [
    'https://extrahand.in',
    'https://www.extrahand.in',
    'http://localhost:3000',
    'http://localhost:4000',
    'http://localhost:4001',
    'http://localhost:4004',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:4000',
    'http://127.0.0.1:4001',
    'http://127.0.0.1:4004',
    'http://127.0.0.1:8080'
  ];
  
  if (env.CORS_ORIGIN) {
    const customOrigins = env.CORS_ORIGIN.split(',').map(origin => origin.trim());
    allowedOrigins.push(...customOrigins);
  }
  
  if (!global.__CORS_CONFIG_LOGGED__) {
    console.log(`🌐 CORS Configuration - Environment: ${env.NODE_ENV}`);
    console.log(`🌐 CORS Allowed Origins:`, allowedOrigins);
    global.__CORS_CONFIG_LOGGED__ = true;
  }
  
  return {
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      if (!origin) {
        if (env.NODE_ENV === 'development') {
          console.log('🔓 CORS: Allowing request with no origin');
        }
        return callback(null, true);
      }
      
      if (env.NODE_ENV === 'development') {
        console.log(`🔍 CORS: Checking origin: ${origin}`);
      }
      
      if (allowedOrigins.includes(origin)) {
        if (env.NODE_ENV === 'development') {
          console.log(`🔓 CORS: Allowing origin: ${origin}`);
        }
        callback(null, true);
      } else {
        console.log(`🔒 CORS: Blocking origin: ${origin}`);
        console.log(`🔒 CORS: Origin not in allowed list. Allowed origins:`, allowedOrigins);
        callback(new Error(`Origin ${origin} not allowed by CORS policy`));
      }
    },
    credentials: true,
    optionsSuccessStatus: 204,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
        'X-Refresh-Token',
      'Cache-Control',
      'Pragma',
      'X-API-Key',
      'X-Service-Auth',
      'X-User-Id',
      'X-Service-Name'
    ],
    preflightContinue: false,
    exposedHeaders: ['Content-Length', 'X-Foo'],
    maxAge: 86400 // 24 hours
  };
}

export function validateEnv() {
  try {
    const env = envSchema.parse(process.env);
    
    // Check for Firebase credentials
    const hasFirebaseEnvVars = env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY;
    const hasFirebaseServiceAccountPath = env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const hasGoogleCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    
    const serviceAccountPath = path.join(__dirname, '..', '..', 'serviceAccountKey.json');
    const hasServiceAccountFile = fs.existsSync(serviceAccountPath);
    
    const hasFirebaseCredentials = hasFirebaseEnvVars || hasFirebaseServiceAccountPath || hasGoogleCredentials || hasServiceAccountFile;
    
    if (!hasFirebaseCredentials && env.NODE_ENV === 'production') {
      throw new Error('Firebase credentials must be provided in production. Either set environment variables or ensure serviceAccountKey.json exists.');
    }
    
    if (hasServiceAccountFile) {
      console.log('✅ Firebase service account file found: serviceAccountKey.json');
    } else if (hasFirebaseEnvVars) {
      console.log('✅ Firebase credentials found in environment variables');
    } else if (hasFirebaseServiceAccountPath) {
      console.log('✅ Firebase service account path specified:', env.FIREBASE_SERVICE_ACCOUNT_PATH);
    } else if (hasGoogleCredentials) {
      console.log('✅ Google Application Credentials found');
    }
    
    return env;
  } catch (error) {
    console.error('❌ Environment validation failed:');
    if (error instanceof z.ZodError) {
      error.errors.forEach(err => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
    } else {
      console.error(`  - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    process.exit(1);
  }
}

export type EnvConfig = z.infer<typeof envSchema>;
