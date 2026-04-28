require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'https://impactmatch-ngo.vercel.app'],
  credentials: true
}));
app.use(helmet());
app.use(morgan('dev'));

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/needs', require('./routes/need.routes'));
app.use('/api/matches', require('./routes/match.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/admin', require('./routes/admin.routes'));

// Health Check for Render/Monitoring
app.get('/', (req, res) => res.json({ status: 'healthy', message: 'ImpactMatch API is active' }));

// Error Handling
const { errorHandler } = require('./middleware/error.middleware');

app.use(errorHandler);

const { runAutoAssignment } = require('./services/matching.service');

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Start the Matching Engine cycle every 5 minutes
  setInterval(runAutoAssignment, 5 * 60 * 1000);
  // Run once on startup
  runAutoAssignment();
});

module.exports = app;
