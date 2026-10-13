const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
require('dotenv').config();

const serviceAccount = require(process.env.FIREBASE_CREDENTIALS_PATH);
initializeApp({
  credential: cert(serviceAccount)
});

async function deleteAllUsers(nextPageToken) {
  try {
    const listUsersResult = await getAuth().listUsers(1000, nextPageToken);
    const uids = listUsersResult.users.map((userRecord) => userRecord.uid);
    if (uids.length > 0) {
      await getAuth().deleteUsers(uids);
      console.log('Successfully deleted users:', uids);
    } else {
      console.log('No users found.');
    }
    
    if (listUsersResult.pageToken) {
      deleteAllUsers(listUsersResult.pageToken);
    }
  } catch (error) {
    console.log('Error deleting users:', error);
  }
}

deleteAllUsers();
