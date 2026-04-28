const User = require('../models/User');
const Need = require('../models/Need');
const Match = require('../models/Match');

exports.getDashboardStats = async (req, res, next) => {
  try {
    const totalUsers = await User.countDocuments();
    const pendingNGOs = await User.countDocuments({ role: 'ngo', isVerified: false });
    
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayMatches = await Match.countDocuments({ createdAt: { $gte: startOfDay } });

    const totalNeeds = await Need.countDocuments();
    const totalMatches = await Match.countDocuments();

    const heatmapNeeds = await Need.find({ status: 'pending' }, 'location urgencyScore');

    res.json({
      totalUsers,
      pendingNGOs,
      todayMatches,
      totalNeeds,
      totalMatches,
      heatmapData: heatmapNeeds,
      systemUsage: (totalUsers * 2) + totalNeeds + totalMatches
    });
  } catch (error) {
    next(error);
  }
};

exports.getUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const filter = {};
    if (search) {
      filter.$or = [
        { email: { $regex: search, $options: 'i' } },
        { fullName: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(filter)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(filter);

    res.json({ items: users, total, page, limit });
  } catch (error) {
    next(error);
  }
};

exports.verifyUser = async (req, res, next) => {
  try {
    const { verified } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { isVerified: verified }, { new: true });
    res.json(user);
  } catch (error) {
    next(error);
  }
};

exports.deleteUser = async (req, res, next) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (error) {
    next(error);
  }
};
