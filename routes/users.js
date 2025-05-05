import express from 'express';
import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { auth } from '../middleware/auth.js';
import { sendEmail, emailTemplates } from '../utils/emailService.js';
import crypto from 'crypto';
import axios from 'axios';

const router = express.Router();

// Middleware to verify token
const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

// Get user profile
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user profile
router.put('/update', auth, async (req, res) => {
  try {
    const { name, email, phone } = req.body;

    // Check if email is already in use
    if (email !== req.user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'Email already in use' });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { name, email, phone },
      { new: true }
    ).select('-password');

    res.json(user);
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Change password
router.put('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate new password
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    }

    // Find user and validate current password
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Update password - this will trigger the pre-save hook to hash it
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Error changing password. Please try again.' });
  }
});

// Add new address
router.post('/addresses', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const newAddress = req.body;

    // If this is the first address or marked as default, set it as default
    if (user.addresses.length === 0 || newAddress.isDefault) {
      user.addresses = user.addresses.map(addr => ({
        ...addr,
        isDefault: false
      }));
      newAddress.isDefault = true;
    }

    user.addresses.push(newAddress);
    await user.save();

    res.json(user);
  } catch (error) {
    console.error('Error adding address:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update address
router.put('/addresses/:addressId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const addressIndex = user.addresses.findIndex(
      addr => addr._id.toString() === req.params.addressId
    );

    if (addressIndex === -1) {
      return res.status(404).json({ message: 'Address not found' });
    }

    // If setting as default, update other addresses
    if (req.body.isDefault) {
      user.addresses = user.addresses.map(addr => ({
        ...addr,
        isDefault: false
      }));
    }

    user.addresses[addressIndex] = {
      ...user.addresses[addressIndex],
      ...req.body
    };

    await user.save();
    res.json(user);
  } catch (error) {
    console.error('Error updating address:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete address
router.delete('/addresses/:addressId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const addressIndex = user.addresses.findIndex(
      addr => addr._id.toString() === req.params.addressId
    );

    if (addressIndex === -1) {
      return res.status(404).json({ message: 'Address not found' });
    }

    // If deleting default address, set another as default if available
    const wasDefault = user.addresses[addressIndex].isDefault;
    user.addresses.splice(addressIndex, 1);

    if (wasDefault && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
    }

    await user.save();
    res.json(user);
  } catch (error) {
    console.error('Error deleting address:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Set address as default
router.put('/addresses/:addressId/default', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const addressIndex = user.addresses.findIndex(
      addr => addr._id.toString() === req.params.addressId
    );

    if (addressIndex === -1) {
      return res.status(404).json({ message: 'Address not found' });
    }

    user.addresses = user.addresses.map((addr, index) => ({
      ...addr,
      isDefault: index === addressIndex
    }));

    await user.save();
    res.json(user);
  } catch (error) {
    console.error('Error setting default address:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Forgot password route - Send OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'No user found with this email address' });
    }

    // Generate 5-digit OTP
    const otp = Math.floor(10000 + Math.random() * 90000).toString();
    const otpExpiry = Date.now() + 300000; // 5 minutes from now

    // Save OTP to user
    user.otp = otp;
    user.otpExpires = otpExpiry;
    await user.save();

    // Send email with OTP using Brevo API directly
    try {
      const response = await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: { name: 'Parnika Silks', email: process.env.SENDER_EMAIL },
          to: [{ email: user.email }],
          subject: 'Password Reset OTP - Parnika Silks',
          htmlContent: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
              <div style="text-align: center; margin-bottom: 20px;">
                <h1 style="color: #e83e8c;">Password Reset OTP</h1>
              </div>
              <p>Dear ${user.name},</p>
              <p>You have requested to reset your password. Please use the following OTP to proceed:</p>
              <div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px; text-align: center;">
                <h2 style="color: #e83e8c; margin: 0;">${otp}</h2>
              </div>
              <p>This OTP will expire in 5 minutes.</p>
              <p>If you didn't request this password reset, please ignore this email.</p>
              <p>Best regards,<br>Parnika Silks Team</p>
              <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #666; font-size: 12px;">
                <p>This email was sent from Parnika Silks Official</p>
                <p>For any queries, please contact us at parnikasilksofficial@gmail.com</p>
              </div>
            </div>
          `
        },
        {
          headers: {
            'api-key': process.env.BREVO_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      res.json({ 
        message: 'OTP sent successfully to your email',
        email: user.email // Send email back for frontend reference
      });
    } catch (emailError) {
      console.error('Error sending email:', emailError);
      // If email fails, clear the OTP and return error
      user.otp = undefined;
      user.otpExpires = undefined;
      await user.save();
      return res.status(500).json({ 
        message: 'Failed to send OTP email. Please try again later.',
        error: emailError.message 
      });
    }
  } catch (error) {
    console.error('Error in forgot password:', error);
    res.status(500).json({ 
      message: 'Server error. Please try again later.',
      error: error.message 
    });
  }
});

// Verify OTP route
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Find user and verify OTP
    const user = await User.findOne({
      email,
      otp,
      otpExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now

    // Save reset token and clear OTP
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpiry;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.json({ 
      message: 'OTP verified successfully',
      resetToken 
    });
  } catch (error) {
    console.error('Error in verify OTP:', error);
    res.status(500).json({ message: 'Error verifying OTP' });
  }
});

// Reset password route
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    // Find user with valid reset token
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Password reset token is invalid or has expired' });
    }

    // Update password - this will trigger the pre-save hook to hash it
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Send confirmation email using Brevo API directly
    try {
      await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: { name: 'Parnika Silks', email: process.env.SENDER_EMAIL },
          to: [{ email: user.email }],
          subject: 'Password Reset Successful - Parnika Silks',
          htmlContent: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
              <div style="text-align: center; margin-bottom: 20px;">
                <h1 style="color: #e83e8c;">Password Reset Successful</h1>
              </div>
              <p>Dear ${user.name},</p>
              <p>Your password has been successfully reset.</p>
              <p>If you did not make this change, please contact our support team immediately.</p>
              <p>Best regards,<br>Parnika Silks Team</p>
              <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #666; font-size: 12px;">
                <p>This email was sent from Parnika Silks Official</p>
                <p>For any queries, please contact us at parnikasilksofficial@gmail.com</p>
              </div>
            </div>
          `
        },
        {
          headers: {
            'api-key': process.env.BREVO_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (emailError) {
      console.error('Error sending confirmation email:', emailError);
      // Continue with password reset even if email fails
    }

    res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    console.error('Error in reset password:', error);
    res.status(500).json({ message: 'Error resetting password' });
  }
});

export default router; 