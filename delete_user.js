const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
require('dotenv').config();

const serviceAccount = require(process.env.FIREBASE_CREDENTIALS_PATH);
initializeApp({
  credential: cert(serviceAccount)
});

async function deleteGhostUser() {
  try {
    const userRecord = await getAuth().getUserByEmail('neevetha2006@gmail.com');
    await getAuth().deleteUser(userRecord.uid);
    console.log('Successfully deleted user from Firebase:', userRecord.uid);
  } catch (error) {
    console.log('Error deleting user:', error.message);
  }
}

deleteGhostUser();
