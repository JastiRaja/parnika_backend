import express from 'express';
import User from '../models/User.js';
import { adminAuth } from '../middleware/auth.js';
import Order from '../models/Order.js';

const router = express.Router();

// Get all customers (admin only)
router.get('/', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (page - 1) * limit;

    const query = {
      role: 'user',
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ]
    };

    const customers = await User.find(query)
      .select('-password')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);

    // Mask phone numbers for non-admin users
    const maskedCustomers = customers.map(customer => ({
      ...customer.toObject(),
      phone: customer.getMaskedPhone()
    }));

    res.json({
      customers: maskedCustomers,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get customer details (admin only)
router.get('/:id', adminAuth, async (req, res) => {
  try {
    const customer = await User.findById(req.params.id).select('-password');
    
    if (!customer || customer.role !== 'user') {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.json(customer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update customer status (admin only)
router.put('/:id/status', adminAuth, async (req, res) => {
  try {
    const { isActive } = req.body;
    const customer = await User.findById(req.params.id);
    
    if (!customer || customer.role !== 'user') {
      return res.status(404).json({ message: 'Customer not found' });
    }

    customer.isActive = isActive;
    await customer.save();

    res.json({ message: 'Customer status updated successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get customer orders (admin only)
router.get('/:id/orders', adminAuth, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.params.id })
      .populate('items.product', 'name price images')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router; 