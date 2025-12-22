import express from 'express';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import { auth, adminAuth } from '../middleware/auth.js';
import { sendEmail, emailTemplates } from '../utils/emailService.js';
import { body, validationResult } from 'express-validator';


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
      .populate('user', 'name email')
      .populate({
        path: 'items.product',
        select: 'name price images specifications'
      });
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user is authorized to view this order
    const orderUserId = order.user._id ? order.user._id.toString() : order.user.toString();
    if (orderUserId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ message: 'Error fetching order' });
  }
});

// Create new order
router.post('/', verifyToken, [
  body('items')
    .isArray({ min: 1 })
    .withMessage('Items must be a non-empty array'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Item quantity must be a positive integer'),
  body('items.*.price')
    .isFloat({ min: 0 })
    .withMessage('Item price must be a positive number'),
  body('shippingAddress.fullName')
    .trim()
    .escape()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name is required and must be between 2 and 100 characters'),
  body('shippingAddress.addressLine1')
    .trim()
    .escape()
    .isLength({ min: 5, max: 200 })
    .withMessage('Address line 1 is required'),
  body('shippingAddress.city')
    .trim()
    .escape()
    .isLength({ min: 2, max: 50 })
    .withMessage('City is required'),
  body('shippingAddress.state')
    .trim()
    .escape()
    .isLength({ min: 2, max: 50 })
    .withMessage('State is required'),
  body('shippingAddress.postalCode')
    .trim()
    .matches(/^[0-9]{6}$/)
    .withMessage('Postal code must be 6 digits'),
  body('shippingAddress.phone')
    .trim()
    .matches(/^[0-9]{10}$/)
    .withMessage('Phone must be exactly 10 digits'),
  body('paymentMethod')
    .notEmpty()
    .withMessage('Payment method is required')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { items, shippingAddress, paymentMethod } = req.body;

    // Validate required fields
    if (!items || !items.length || !shippingAddress || !paymentMethod) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: items, shippingAddress, or paymentMethod' 
      });
    }

    // Calculate subtotal (sum of all items)
    const subtotal = items.reduce((total, item) => {
      return total + (item.price * item.quantity);
    }, 0);

    // Validate stock and calculate delivery charges
    let deliveryCharges = 0;
    const FREE_DELIVERY_THRESHOLD = 1000;
    
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

      // Calculate delivery charges for this item (only if delivery charges applicable and order total < threshold)
      if (subtotal < FREE_DELIVERY_THRESHOLD && product.deliveryChargesApplicable !== false) {
        const itemDeliveryCharges = (product.deliveryCharges || 0) * item.quantity;
        deliveryCharges += itemDeliveryCharges;
      }
    }

    // If order total >= ₹1000, delivery is free
    if (subtotal >= FREE_DELIVERY_THRESHOLD) {
      deliveryCharges = 0;
    }

    // Calculate total amount (subtotal + delivery charges)
    const totalAmount = subtotal + deliveryCharges;

    // Generate a unique tracking number
    const trackingNumber = `TRK${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Create order
    const order = new Order({
      user: req.user.id,
      items,
      subtotal,
      deliveryCharges,
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
    try {
      const customerEmailResult = await sendEmail({
        to: user.email,
        subject: 'Order Confirmation - Parnika Silks',
        html: emailTemplates.orderConfirmation(user.name, trackingNumber)
      });
      
      if (!customerEmailResult.success) {
        console.error('❌ Failed to send order confirmation email to customer:', customerEmailResult.error || customerEmailResult.message);
      } else {
        console.log('✅ Order confirmation email sent to customer:', user.email);
      }
    } catch (emailError) {
      console.error('❌ Error sending customer email:', emailError);
      // Don't fail the order creation if email fails
    }

    // Send new order notification email to admin
    if (process.env.ADMIN_EMAIL) {
      try {
        const adminEmailResult = await sendEmail({
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
        
        if (!adminEmailResult.success) {
          console.error('❌ Failed to send admin notification email:', adminEmailResult.error || adminEmailResult.message);
        } else {
          console.log('✅ Admin notification email sent to:', process.env.ADMIN_EMAIL);
        }
      } catch (emailError) {
        console.error('❌ Error sending admin email:', emailError);
        // Don't fail the order creation if email fails
      }
    } else {
      console.warn('⚠️ ADMIN_EMAIL not configured, skipping admin notification email');
    }

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

    const { status, expectedDeliveryDate, courierService } = req.body;
    const order = await Order.findById(req.params.id).populate('user');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const previousStatus = order.status;

    // If changing to cancelled, restore stock
    if (status === 'cancelled' && previousStatus !== 'cancelled') {
      for (const item of order.items) {
        const productId = item.product || item._id;
        if (productId) {
          const product = await Product.findById(productId);
          if (product) {
            product.stock += item.quantity;
            await product.save();
            console.log(`Restored ${item.quantity} units of stock for product ${product.name}`);
          }
        }
      }
    }

    // If changing from cancelled to another status, decrement stock again
    if (previousStatus === 'cancelled' && status !== 'cancelled') {
      for (const item of order.items) {
        const productId = item.product || item._id;
        if (productId) {
          const product = await Product.findById(productId);
          if (product) {
            if (product.stock < item.quantity) {
              return res.status(400).json({ 
                success: false,
                message: `Cannot change order status: Insufficient stock for product ${product.name}. Available: ${product.stock}, Required: ${item.quantity}` 
              });
            }
            product.stock -= item.quantity;
            await product.save();
            console.log(`Deducted ${item.quantity} units of stock for product ${product.name}`);
          }
        }
      }
    }

    order.status = status;
    
    // If status is being changed to "shipped", update expected delivery date and courier service
    if (status === 'shipped') {
      if (expectedDeliveryDate) {
        order.expectedDeliveryDate = new Date(expectedDeliveryDate);
      }
      if (courierService) {
        order.courierService = courierService;
      }
    }

    await order.save();

    // Send status update email to customer
    try {
      const emailResult = await sendEmail({
        to: order.user.email,
        subject: 'Order Status Update - Parnika Silks',
        html: emailTemplates.orderStatusUpdate(order.user.name, order.trackingNumber, status)
      });
      
      if (!emailResult.success) {
        console.error('❌ Failed to send status update email:', emailResult.error || emailResult.message);
      } else {
        console.log('✅ Status update email sent to:', order.user.email);
      }
    } catch (emailError) {
      console.error('❌ Error sending status update email:', emailError);
      // Don't fail the status update if email fails
    }

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

    // Restore product stock when order is cancelled
    for (const item of order.items) {
      const productId = item.product || item._id;
      if (productId) {
        const product = await Product.findById(productId);
        if (product) {
          product.stock += item.quantity;
          await product.save();
          console.log(`Restored ${item.quantity} units of stock for product ${product.name}`);
        }
      }
    }

    order.status = 'cancelled';
    order.cancellationReason = reason;
    await order.save();

    res.json({ message: 'Order cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling order:', error);
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