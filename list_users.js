const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
require('dotenv').config();

const serviceAccount = require(process.env.FIREBASE_CREDENTIALS_PATH);
initializeApp({
  credential: cert(serviceAccount)
});

async function listAllUsers(nextPageToken) {
  try {
    const listUsersResult = await getAuth().listUsers(1000, nextPageToken);
    listUsersResult.users.forEach((userRecord) => {
      console.log('user', userRecord.toJSON());
    });
    if (listUsersResult.pageToken) {
      listAllUsers(listUsersResult.pageToken);
    }
  } catch (error) {
    console.log('Error listing users:', error);
  }
}

listAllUsers();
