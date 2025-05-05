import express from 'express';
import { sendEmail } from '../utils/emailService.js';

const router = express.Router();

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