import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const SENDER_EMAIL = process.env.SENDER_EMAIL;
const SENDER_NAME = 'Parnika Silks';

export const sendEmail = async ({ to, subject, html }) => {
  // Validate required environment variables
  if (!process.env.BREVO_API_KEY) {
    console.error('❌ BREVO_API_KEY is not configured in environment variables');
    console.error('Please add BREVO_API_KEY to your .env file');
    return { success: false, message: 'Email service not configured: BREVO_API_KEY missing' };
  }

  if (!SENDER_EMAIL) {
    console.error('❌ SENDER_EMAIL is not configured in environment variables');
    console.error('Please add SENDER_EMAIL to your .env file');
    return { success: false, message: 'Email service not configured: SENDER_EMAIL missing' };
  }

  // Validate recipient email
  if (!to) {
    console.error('❌ Recipient email (to) is required');
    return { success: false, message: 'Recipient email is required' };
  }

  try {
    console.log(`📧 Attempting to send email to: ${to}`);
    console.log(`📧 From: ${SENDER_EMAIL}`);
    console.log(`📧 Subject: ${subject}`);

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
        timeout: 10000 // 10 second timeout
      }
    );
    
    console.log('✅ Email sent successfully:', response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('❌ Error sending email via Brevo API:');
    console.error('Error details:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      config: {
        url: error.config?.url,
        method: error.config?.method
      }
    });

    // Provide more specific error messages
    let errorMessage = 'Failed to send email';
    if (error.response?.status === 401) {
      errorMessage = 'Invalid Brevo API key. Please check BREVO_API_KEY in .env file';
    } else if (error.response?.status === 400) {
      errorMessage = `Invalid email request: ${JSON.stringify(error.response?.data)}`;
    } else if (error.response?.status === 402) {
      errorMessage = 'Brevo account limit reached or payment required';
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Email service timeout. Please try again later';
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      errorMessage = 'Cannot connect to Brevo email service. Check your internet connection';
    } else {
      errorMessage = error.response?.data?.message || error.message || 'Unknown error occurred';
    }

    return { success: false, error: errorMessage, details: error.response?.data };
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