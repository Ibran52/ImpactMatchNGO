const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });
async function fixDB() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('DATABASE CONNECT SUCCEFULLY ✅ ');
  
  try {
    // Drop the old index
    await mongoose.connection.collection('users').dropIndex('currentLocation_2dsphere');
    console.log('Dropped old index');
  } catch(e) {
    console.log('Index drop error (might not exist):', e.message);
  }

  // Remove broken test users that have bad geolocation data
  const result = await mongoose.connection.collection('users').deleteMany({
    email: { $in: ['volunteer@test.com', 'ngo@test.com', 'test@user.com'] }
  });
  console.log('Deleted bad test users:', result.deletedCount);
  
  // Recreate the index correctly
  const User = require('./src/models/User');
  await User.init();
  console.log('Re-created models and indexes');

  process.exit(0);
}
fixDB();
