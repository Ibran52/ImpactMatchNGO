const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./src/models/User');
require('dotenv').config();

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB for seeding...');

    const adminEmail = 'mdibransiddique02@gmail.com';
    const adminPassword = 'admin123'; // Default password

    // Check if user exists
    let user = await User.findOne({ email: adminEmail });

    if (user) {
      console.log('Admin user already exists. Updating role to admin...');
      user.role = 'admin';
      user.isVerified = true;
      user.password = await bcrypt.hash(adminPassword, 10);
      await user.save();
    } else {
      console.log('Creating new admin user...');
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await User.create({
        email: adminEmail,
        password: hashedPassword,
        role: 'admin',
        fullName: 'System Admin',
        isVerified: true
      });
    }

    console.log('-----------------------------------');
    console.log('Admin Login Credentials Created:');
    console.log(`Email: ${adminEmail}`);
    console.log(`Password: ${adminPassword}`);
    console.log('-----------------------------------');
    
    process.exit(0);
  } catch (error) {
    console.error('Error seeding admin:', error);
    process.exit(1);
  }
};

seedAdmin();
