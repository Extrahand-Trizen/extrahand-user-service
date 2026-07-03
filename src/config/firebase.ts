import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import logger from './logger';

export const MOBILE_FIREBASE_APP_NAME = 'extrahand-mobile-firebase';

function loadCredentialFromEnv(projectId?: string, clientEmail?: string, privateKey?: string) {
  if (!projectId || !clientEmail || !privateKey) return undefined;
  return admin.credential.cert({
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, '\n'),
  });
}

function loadCredentialFromFile(candidatePath?: string) {
  if (!candidatePath || !fs.existsSync(candidatePath)) return undefined;
  const serviceAccount = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
  return admin.credential.cert(serviceAccount);
}

function initPrimaryFirebase() {
  let credential: admin.credential.Credential | undefined;

  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
    FIREBASE_SERVICE_ACCOUNT_PATH,
  } = process.env;

  try {
    credential =
      loadCredentialFromEnv(FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) ??
      loadCredentialFromFile(
        FIREBASE_SERVICE_ACCOUNT_PATH || path.join(__dirname, '..', '..', 'serviceAccountKey.json'),
      );
    if (credential) {
      logger.info('✅ Firebase primary project initialized from env/file');
    }
  } catch (e) {
    logger.warn('⚠️ Failed to load primary Firebase credentials from env/file, falling back to ADC');
  }

  if (credential) {
    admin.initializeApp({ credential });
    return;
  }

  try {
    admin.initializeApp();
    logger.info('✅ Firebase primary project initialized with Application Default Credentials');
  } catch (error) {
    logger.error('❌ Failed to initialize primary Firebase:', error);
    throw new Error('Firebase initialization failed. Please provide credentials.');
  }
}

function initMobileFirebase() {
  const {
    FIREBASE_MOBILE_PROJECT_ID,
    FIREBASE_MOBILE_CLIENT_EMAIL,
    FIREBASE_MOBILE_PRIVATE_KEY,
    FIREBASE_MOBILE_SERVICE_ACCOUNT_PATH,
  } = process.env;

  try {
    const credential =
      loadCredentialFromEnv(
        FIREBASE_MOBILE_PROJECT_ID,
        FIREBASE_MOBILE_CLIENT_EMAIL,
        FIREBASE_MOBILE_PRIVATE_KEY,
      ) ??
      loadCredentialFromFile(
        FIREBASE_MOBILE_SERVICE_ACCOUNT_PATH ||
          path.join(__dirname, '..', '..', 'serviceAccountKey-mobile.json'),
      );

    if (!credential) {
      logger.info(
        'ℹ️ Mobile Firebase project not configured (optional). ' +
          'Set FIREBASE_MOBILE_* or serviceAccountKey-mobile.json for extrahand-ca02c mobile apps.',
      );
      return;
    }

    admin.initializeApp({ credential }, MOBILE_FIREBASE_APP_NAME);
    logger.info('✅ Firebase mobile project initialized', {
      projectId: FIREBASE_MOBILE_PROJECT_ID || 'from service account file',
    });
  } catch (error) {
    logger.warn('⚠️ Failed to initialize mobile Firebase project:', error);
  }
}

if (!admin.apps.length) {
  initPrimaryFirebase();
  initMobileFirebase();
}

export const auth = admin.auth();
const mobileApp = admin.apps.find(
  (app): app is admin.app.App => app != null && app.name === MOBILE_FIREBASE_APP_NAME,
);
export const mobileAuth = mobileApp ? admin.auth(mobileApp) : null;
export const hasMobileFirebase = Boolean(mobileAuth);
export const db = admin.firestore();
export { admin };
