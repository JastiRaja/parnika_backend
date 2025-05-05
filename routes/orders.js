import express from 'express';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import jwt from 'jsonwebtoken';
import { auth, adminAuth } from '../middleware/auth.js';
import { sendEmail, emailTemplates } from '../utils/emailService.js';
import User from '../models/User.js';

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

// Get all orders (admin only)
router.get('/', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const orders = await Order.find()
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching orders' });
  }
});

// Get user's orders
router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id })
      .populate({
        path: 'items.product',
        select: 'name price images specifications'
      })
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ message: 'Error fetching orders' });
  }
});

// Get single order
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate({
        path: 'items.product',
        select: 'name price images specifications'
      });
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user is authorized to view this order
    if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ message: 'Error fetching order' });
  }
});

// Create new order
router.post('/', verifyToken, async (req, res) => {
  try {
    const { items, shippingAddress, paymentMethod } = req.body;

    // Validate required fields
    if (!items || !items.length || !shippingAddress || !paymentMethod) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: items, shippingAddress, or paymentMethod' 
      });
    }

    // Calculate total amount
    const totalAmount = items.reduce((total, item) => {
      return total + (item.price * item.quantity);
    }, 0);

    // Validate stock before creating order
    for (const item of items) {
      const productId = item._id || item.product;
      if (!productId) {
        return res.status(400).json({ 
          success: false, 
          message: 'Product ID is missing in one or more items' 
        });
      }

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(400).json({ 
          success: false, 
          message: `Product with ID ${productId} not found` 
        });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({ 
          success: false, 
          message: `Insufficient stock for product: ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}` 
        });
      }
    }

    // Generate a unique tracking number
    const trackingNumber = `TRK${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Create order
    const order = new Order({
      user: req.user.id,
      items,
      totalAmount,
      shippingAddress,
      paymentMethod,
      status: 'pending',
      trackingNumber
    });

    // Save order
    await order.save();

    // Update product stock
    for (const item of items) {
      const productId = item._id || item.product;
      const product = await Product.findById(productId);
      product.stock -= item.quantity;
      await product.save();
    }

    // Get user details for email
    const user = await User.findById(req.user.id);

    // Send order confirmation email to customer
    await sendEmail({
      to: user.email,
      subject: 'Order Confirmation - Parnika Silks',
      html: emailTemplates.orderConfirmation(user.name, trackingNumber)
    });

    // Send new order notification email to admin
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: 'New Order Placed - Parnika Silks',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #4a5568;">New Order Placed</h1>
          <p>A new order has been placed:</p>
          <ul>
            <li>Order ID: ${order._id}</li>
            <li>Tracking Number: ${trackingNumber}</li>
            <li>Customer: ${user.name} (${user.email})</li>
            <li>Total Amount: ₹${totalAmount.toLocaleString()}</li>
          </ul>
          <h3>Order Items:</h3>
          <ul>
            ${items.map(item => `<li>${item.quantity} × ${item.name || item.product?.name || 'Product'} @ ₹${item.price}</li>`).join('')}
          </ul>
          <h3>Shipping Address:</h3>
          <p>${shippingAddress.fullName}<br>
          ${shippingAddress.addressLine1}<br>
          ${shippingAddress.addressLine2 ? shippingAddress.addressLine2 + '<br>' : ''}
          ${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.pincode}<br>
          Phone: ${shippingAddress.phone}</p>
        </div>
      `
    });

    // Send success response
    res.status(201).json({ 
      success: true, 
      message: 'Order created successfully', 
      order 
    });
   
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error creating order', 
      error: error.message 
    });
  }
});

// Update order status (admin only)
router.put('/:id/status', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { status } = req.body;
    const order = await Order.findById(req.params.id).populate('user');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    order.status = status;
    await order.save();

    // Send status update email to customer
    await sendEmail({
      to: order.user.email,
      subject: 'Order Status Update - Parnika Silks',
      html: emailTemplates.orderStatusUpdate(order.user.name, order.trackingNumber, status)
    });

    res.json({ success: true, order });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ message: 'Error updating order status' });
  }
});

// Cancel order
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const { reason } = req.body;
    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending orders can be cancelled' });
    }

    order.status = 'cancelled';
    order.cancellationReason = reason;
    await order.save();

    res.json({ message: 'Order cancelled successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Submit refund request
router.post('/:id/refund', auth, async (req, res) => {
  try {
    const { bankDetails } = req.body;
    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (order.status !== 'cancelled') {
      return res.status(400).json({ message: 'Only cancelled orders can be refunded' });
    }

    order.refundDetails = bankDetails;
    await order.save();

    res.json({ 
      message: 'Refund request submitted successfully',
      contactNumber: '+91 1234567890' // Replace with actual contact number
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router; 