import express from 'express';
import { sendEmail } from '../utils/emailService.js';
import { adminAuth } from '../middleware/auth.js';

const router = express.Router();

// Test email endpoint (admin only) - for debugging
router.post('/test', adminAuth, async (req, res) => {
  try {
    const { to } = req.body;
    
    if (!to) {
      return res.status(400).json({ 
        success: false, 
        message: 'Recipient email (to) is required' 
      });
    }

    const testResult = await sendEmail({
      to,
      subject: 'Test Email - Parnika Silks',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #e83e8c;">Test Email</h1>
          </div>
          <p>This is a test email from Parnika Silks.</p>
          <p>If you received this email, your email service is working correctly!</p>
          <p>Best regards,<br>Parnika Silks Team</p>
        </div>
      `
    });

    if (testResult.success) {
      res.json({ 
        success: true, 
        message: 'Test email sent successfully',
        data: testResult.data
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to send test email',
        error: testResult.error || testResult.message,
        details: testResult.details
      });
    }
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error sending test email',
      error: error.message 
    });
  }
});

// Check email configuration (admin only)
router.get('/config', adminAuth, async (req, res) => {
  const config = {
    hasBrevoApiKey: !!process.env.BREVO_API_KEY,
    hasSenderEmail: !!process.env.SENDER_EMAIL,
    hasAdminEmail: !!process.env.ADMIN_EMAIL,
    senderEmail: process.env.SENDER_EMAIL || 'Not configured',
    adminEmail: process.env.ADMIN_EMAIL || 'Not configured',
    brevoApiKeyLength: process.env.BREVO_API_KEY ? process.env.BREVO_API_KEY.length : 0,
    brevoApiKeyPrefix: process.env.BREVO_API_KEY ? process.env.BREVO_API_KEY.substring(0, 8) + '...' : 'Not configured'
  };

  res.json({ success: true, config });
});

router.post('/order-confirmation', async (req, res) => {
  const order = req.body;
  // Compose a simple HTML email using order details
  const html = `
    <h1>Order Confirmation</h1>
    <p>Dear ${order.shippingAddress.fullName},</p>
    <p>Thank you for your order! Your order has been confirmed and is being processed.</p>
    <h2>Order Details:</h2>
    <p>Order ID: ${order.orderId}</p>
    ${order.trackingNumber ? `<p>Tracking Number: ${order.trackingNumber}</p>` : ''}
    <h3>Items:</h3>
    <ul>
      ${order.items.map(item => `
        <li>${item.name} - ₹${item.price} x ${item.quantity}</li>
      `).join('')}
    </ul>
    <p>Total Amount: ₹${order.totalAmount}</p>
    <h3>Shipping Address:</h3>
    <p>${order.shippingAddress.fullName}<br>
    ${order.shippingAddress.addressLine1}<br>
    ${order.shippingAddress.addressLine2 ? order.shippingAddress.addressLine2 + '<br>' : ''}
    ${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode}<br>
    Phone: ${order.shippingAddress.phone}</p>
    <p>Payment Method: ${order.paymentMethod}</p>
    <p>If you have any questions, please contact our customer support.</p>
  `;
  const to = order.shippingAddress?.email || 'parnikasilksofficial@gmail.com'; // Use actual email from order

  try {
    const result = await sendEmail({
      to,
      subject: `Order Confirmation - #${order.orderId}`,
      html,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send email', error: err.message });
  }
});

export default router; 