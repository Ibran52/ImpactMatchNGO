const mongoose = require('mongoose');
const User = require('./src/models/User');
const Need = require('./src/models/Need');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function seedTestData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB...');

    // Clear existing test users
    await User.deleteMany({ email: /test\.com$/ });
    await Need.deleteMany({ title: /Test Need/ });

    const salt = await bcrypt.genSalt(10);
    const password = await bcrypt.hash('password123', salt);

    // 1. Create NGO
    const ngo = await User.create({
      fullName: 'Kalyan Health NGO (Test)',
      email: 'ngo@test.com',
      password: password,
      role: 'ngo',
      isVerified: true
    });
    console.log('NGO created: ngo@test.com');

    // 2. Create Volunteer
    const volunteer = await User.create({
      fullName: 'John Helper (Test)',
      email: 'volunteer@test.com',
      password: password,
      role: 'volunteer',
      isVerified: true,
      skills: ['First Aid', 'Driving']
    });
    console.log('Volunteer created: volunteer@test.com');

    // 3. Create Admin
    const admin = await User.create({
      fullName: 'Impact Admin (Test)',
      email: 'admin@test.com',
      password: password,
      role: 'admin',
      isVerified: true
    });
    console.log('Admin created: admin@test.com');

    // 4. Create sample Needs for Heatmap
    const needs = [
      {
        title: 'Test Need: Medical Supplies',
        description: 'Urgent bandages needed at station.',
        urgency: 'critical',
        status: 'pending',
        locationName: 'Kalyan Junction',
        location: { type: 'Point', coordinates: [73.1300, 19.2400] }, // Kalyan
        ngoUserId: ngo._id
      },
      {
        title: 'Test Need: Food Distribution',
        description: 'Volunteers needed for lunch.',
        urgency: 'medium',
        status: 'pending',
        locationName: 'Dombivli East',
        location: { type: 'Point', coordinates: [73.0800, 19.2100] }, // Dombivli
        ngoUserId: ngo._id
      }
    ];

    await Need.insertMany(needs);
    console.log('Sample needs created for heatmap visualization.');

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

seedTestData();
