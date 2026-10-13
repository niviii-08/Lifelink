const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const fs = require('fs');

if (process.env.FIREBASE_CREDENTIALS_PATH && fs.existsSync(process.env.FIREBASE_CREDENTIALS_PATH)) {
  const serviceAccount = require(process.env.FIREBASE_CREDENTIALS_PATH);
  initializeApp({
    credential: cert(serviceAccount)
  });
  console.log('[Firebase] Admin initialized via credentials file.');
} else {
  // Try default application credentials
  initializeApp();
  console.log('[Firebase] Admin initialized via default credentials.');
}

async function getActorFromRequest(req, db) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;
  
  try {
    const decodedToken = await getAuth().verifyIdToken(token);
    const userId = decodedToken.uid;
    const row = db.prepare('SELECT id, name, role, status FROM users WHERE id = ?').get(userId);
    return row || null;
  } catch (err) {
    console.error('Firebase token verification failed:', err.message);
    return null;
  }
}

module.exports = { getActorFromRequest };
