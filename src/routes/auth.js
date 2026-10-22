const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    let existingUser = await User.findOne({ email: cleanEmail });

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000);
    const hashedPassword = await bcrypt.hash(password, 10);

    if (existingUser) {
      if (existingUser.isVerified) {
        return res.status(409).json({ message: 'An account with this email already exists' });
      }
      existingUser.name = name;
      existingUser.password = hashedPassword;
      existingUser.otp = otp;
      existingUser.otpExpiry = otpExpiry;
      await existingUser.save();
    } else {
      existingUser = await User.create({
        name,
        email: cleanEmail,
        password: hashedPassword,
        otp,
        otpExpiry,
        isVerified: false,
      });
    }

    console.log(`[Auth Register] Verification OTP for ${cleanEmail}: ${otp}`);

    return res.status(201).json({
      success: true,
      message: 'Account created! Verification code has been sent.',
      email: cleanEmail,
      otp, // Convenient in dev
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/auth/login or /api/auth/mobile-login
const handleLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(404).json({ message: 'No account found with this email' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ message: 'Please verify your email OTP before logging in' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    const secret = process.env.JWT_SECRET || 'JWT_SUPER_SECRET_KEY_EXPENSEFLOW_AI_2026';
    const tokenPayload = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      isOnboarded: user.isOnboarded,
      isAdmin: user.isAdmin,
    };

    const token = jwt.sign(tokenPayload, secret, { expiresIn: '30d' });

    return res.json({
      success: true,
      user: tokenPayload,
      token,
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

router.post('/login', handleLogin);
router.post('/mobile-login', handleLogin);

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp, type } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (String(user.otp).trim() !== String(otp).trim()) {
      return res.status(400).json({ message: 'Invalid OTP code' });
    }

    if (user.otpExpiry && new Date() > user.otpExpiry) {
      return res.status(410).json({ message: 'OTP has expired' });
    }

    if (type === 'signup') {
      user.isVerified = true;
      user.otp = null;
      user.otpExpiry = null;
      await user.save();
    }

    return res.json({ success: true, message: 'OTP verified successfully' });
  } catch (err) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const cleanEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    console.log(`[Send OTP] OTP for ${cleanEmail}: ${otp}`);
    return res.json({ success: true, message: 'OTP sent' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.password = await bcrypt.hash(password, 10);
    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    return res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
