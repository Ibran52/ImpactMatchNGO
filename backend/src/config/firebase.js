const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    console.log('Firebase Admin initialized');
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
  }
}

module.exports = admin;
