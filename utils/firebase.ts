import admin from 'firebase-admin';

// Initialize Firebase Admin SDK
let firebaseAdmin: admin.app.App | null = null;

export function initializeFirebaseAdmin() {
  if (firebaseAdmin) {
    return firebaseAdmin;
  }

  try {
    // Get Firebase service account from environment variables
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (!serviceAccount) {
      console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT not found. Firebase authentication disabled.');
      return null;
    }

    // Parse the service account JSON
    let serviceAccountJson;
    try {
      serviceAccountJson = JSON.parse(serviceAccount);
    } catch (error) {
      console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', error);
      return null;
    }

    // Initialize Firebase Admin
    firebaseAdmin = admin.initializeApp({
      credential: admin.credential.cert(serviceAccountJson as admin.ServiceAccount),
      projectId: serviceAccountJson.project_id,
    });

    console.log('✅ Firebase Admin SDK initialized');
    console.log(`   Project ID: ${serviceAccountJson.project_id}`);
    return firebaseAdmin;
  } catch (error: any) {
    console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
    return null;
  }
}

export async function verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken | null> {
  if (!firebaseAdmin) {
    firebaseAdmin = initializeFirebaseAdmin();
    if (!firebaseAdmin) {
      return null;
    }
  }

  try {
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error: any) {
    console.error('❌ Error verifying ID token:', error.message);
    return null;
  }
}

export function getFirebaseAdmin(): admin.app.App | null {
  if (!firebaseAdmin) {
    firebaseAdmin = initializeFirebaseAdmin();
  }
  return firebaseAdmin;
}

