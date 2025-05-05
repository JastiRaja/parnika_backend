import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const SENDER_EMAIL = process.env.SENDER_EMAIL;
const SENDER_NAME = 'Parnika Silks';

export const sendEmail = async ({ to, subject, html }) => {
  if (!process.env.BREVO_API_KEY) {
    console.warn('Brevo API key is not configured, skipping email sending');
    return { success: false, message: 'Email service not configured' };
  }

  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: Array.isArray(to) ? to.map(email => ({ email })) : [{ email: to }],
        subject,
        htmlContent: html,
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Error sending email via Brevo API:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
};

// Email templates with consistent branding
export const emailTemplates = {
  welcome: (name) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #e83e8c;">Welcome to Parnika Silks!</h1>
      </div>
      <p>Dear ${name},</p>
      <p>Thank you for registering with Parnika Silks. We're excited to have you as part of our family!</p>
      <p>At Parnika Silks, we offer a wide range of premium silk products and traditional wear.</p>
      <p>Best regards,<br>Parnika Silks Team</p>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #666; font-size: 12px;">
        <p>This email was sent from Parnika Silks Official</p>
        <p>For any queries, please contact us at ${SENDER_EMAIL}</p>
      </div>
    </div>
  `,
  orderConfirmation: (name, trackingNumber) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #e83e8c;">Order Confirmation</h1>
      </div>
      <p>Dear ${name},</p>
      <p>Thank you for your order with Parnika Silks!</p>
      <p>Your tracking number is: <strong>${trackingNumber}</strong></p>
      <p>We will process your order and keep you updated on its status. You can track your order using the tracking number above.</p>
      <p>Best regards,<br>Parnika Silks Team</p>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #666; font-size: 12px;">
        <p>This email was sent from Parnika Silks Official</p>
        <p>For any queries, please contact us at ${SENDER_EMAIL}</p>
      </div>
    </div>
  `,
  orderStatusUpdate: (name, trackingNumber, status) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #e83e8c;">Order Status Update</h1>
      </div>
      <p>Dear ${name},</p>
      <p>Your order (Tracking Number: <strong>${trackingNumber}</strong>) has been updated.</p>
      <p>Current Status: <strong style="color: #e83e8c;">${status.toUpperCase()}</strong></p>
      <div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
        <p style="margin: 0;">Status Description:</p>
        <ul style="margin: 10px 0;">
          ${status === 'pending' ? '<li>Your order has been received and is awaiting processing.</li>' : ''}
          ${status === 'processing' ? '<li>We are currently processing your order.</li>' : ''}
          ${status === 'shipped' ? '<li>Your order has been shipped and is on its way!</li>' : ''}
          ${status === 'delivered' ? '<li>Your order has been delivered successfully.</li>' : ''}
          ${status === 'cancelled' ? '<li>Your order has been cancelled.</li>' : ''}
        </ul>
      </div>
      <p>Best regards,<br>Parnika Silks Team</p>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #666; font-size: 12px;">
        <p>This email was sent from Parnika Silks Official</p>
        <p>For any queries, please contact us at ${SENDER_EMAIL}</p>
      </div>
    </div>
  `,
  forgotPassword: (name, otp) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #e83e8c;">Password Reset OTP</h1>
      </div>
      <p>Dear ${name},</p>
      <p>You have requested to reset your password. Please use the following OTP to proceed:</p>
      <div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px; text-align: center;">
        <h2 style="color: #e83e8c; margin: 0;">${otp}</h2>
      </div>
      <p>This OTP will expire in 5 minutes.</p>
      <p>If you didn't request this password reset, please ignore this email.</p>
      <p>Best regards,<br>Parnika Silks Team</p>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #666; font-size: 12px;">
        <p>This email was sent from Parnika Silks Official</p>
        <p>For any queries, please contact us at ${SENDER_EMAIL}</p>
      </div>
    </div>
  `,
  passwordResetSuccess: (name) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h1 style="color: #e83e8c;">Password Reset Successful</h1>
      </div>
      <p>Dear ${name},</p>
      <p>Your password has been successfully reset.</p>
      <p>If you did not make this change, please contact our support team immediately.</p>
      <p>Best regards,<br>Parnika Silks Team</p>
      <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #666; font-size: 12px;">
        <p>This email was sent from Parnika Silks Official</p>
        <p>For any queries, please contact us at ${SENDER_EMAIL}</p>
      </div>
    </div>
  `
};