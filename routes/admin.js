import express from 'express';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { ObjectId, GridFSBucket } from 'mongodb';
import mongoose from 'mongoose';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure GridFS storage for multer
// Note: MongoDB URI should always come from environment variables in production
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set in environment variables');
}

// File upload security configuration
const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const maxFileSize = 5 * 1024 * 1024; // 5MB
const maxFiles = 5;

// File filter function
const fileFilter = (req, file, cb) => {
  // Check MIME type
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Only ${allowedMimeTypes.join(', ')} are allowed.`), false);
  }
};

// Configure multer with security settings
const upload = multer({
  limits: {
    fileSize: maxFileSize,
    files: maxFiles
  },
  fileFilter: fileFilter
});

// Middleware to check if user is admin
const isAdmin = async (req, res, next) => {
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

    if (user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin only.' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

// Get dashboard stats
router.get('/dashboard', isAdmin, async (req, res) => {
  try {
    const totalProducts = await Product.countDocuments();
    const totalOrders = await Order.countDocuments();
    const totalUsers = await User.countDocuments();
    const recentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('user', 'name email');

    res.json({
      success: true,
      data: {
        totalProducts,
        totalOrders,
        totalUsers,
        recentOrders
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching dashboard data' });
  }
});

// Get all orders
router.get('/orders', isAdmin, async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching orders' });
  }
});

// Get all products
router.get('/products', isAdmin, async (req, res) => {
  try {
    const products = await Product.find();
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching products' });
  }
});

// Get single product
router.get('/products/:id', isAdmin, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching product' });
  }
});

// Get all users
router.get('/users', isAdmin, async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).select('-password');
    res.json({ users });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// Create product
router.post('/products', isAdmin, upload.array('images', 5), async (req, res) => {
  try {
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, message: 'Database connection not available. Please try again.' });
    }

    const db = mongoose.connection.db;
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database not initialized' });
    }

    // Validate files
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one image is required' });
    }

    // Check file count
    if (req.files.length > maxFiles) {
      return res.status(400).json({ success: false, message: `Maximum ${maxFiles} files allowed` });
    }

    // Validate each file
    for (const file of req.files) {
      // Check file size
      if (file.size > maxFileSize) {
        return res.status(400).json({ success: false, message: `File ${file.originalname} exceeds maximum size of ${maxFileSize / 1024 / 1024}MB` });
      }
      
      // Check MIME type
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return res.status(400).json({ success: false, message: `File ${file.originalname} has invalid type. Only images are allowed.` });
      }
    }

    const bucket = new GridFSBucket(db, { bucketName: 'uploads' });
    // Save each uploaded file to GridFS and collect their IDs
    const imageIds = [];
    for (const file of req.files) {
      try {
        // Sanitize filename to prevent path traversal
        const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const timestamp = Date.now();
        const finalFilename = `${timestamp}_${sanitizedFilename}`;
        
        const uploadStream = bucket.openUploadStream(finalFilename, {
          contentType: file.mimetype,
        });
        uploadStream.end(file.buffer);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Image upload timeout'));
          }, 30000); // 30 second timeout

          uploadStream.on('finish', () => {
            clearTimeout(timeout);
            imageIds.push(uploadStream.id);
            resolve();
          });
          uploadStream.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
      } catch (fileError) {
        console.error('Error uploading file:', fileError);
        throw new Error(`Failed to upload image: ${fileError.message}`);
      }
    }
    const { name, description, price, category, stock, specifications } = req.body;
    if (!name || !description || !price || !category) {
      return res.status(400).json({ success: false, message: 'All required fields must be provided' });
    }
    // Parse specifications from JSON string
    let parsedSpecifications;
    try {
      parsedSpecifications = JSON.parse(specifications);
    } catch (error) {
      console.error('Error parsing specifications:', error);
      parsedSpecifications = {
        material: 'Not specified',
        color: 'Not specified'
      };
    }
    // Ensure specifications has required fields
    const finalSpecifications = {
      material: parsedSpecifications.material || 'Not specified',
      color: parsedSpecifications.color || 'Not specified'
    };
    const product = new Product({
      name,
      description,
      price: parseFloat(price),
      category,
      stock: parseInt(stock) || 0,
      specifications: finalSpecifications,
      images: imageIds
    });
    console.log('Creating product with specifications:', finalSpecifications);
    const savedProduct = await product.save();
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product: savedProduct
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ success: false, message: error.message || 'Error creating product' });
  }
});

// Update product
router.put('/products/:id', isAdmin, upload.array('images', 5), async (req, res) => {
  try {
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, message: 'Database connection not available. Please try again.' });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const db = mongoose.connection.db;
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database not initialized' });
    }

    const bucket = new GridFSBucket(db, { bucketName: 'uploads' });
    // Save each newly uploaded file to GridFS and collect their IDs
    const newImageIds = [];
    for (const file of req.files) {
      try {
        const uploadStream = bucket.openUploadStream(file.originalname, {
          contentType: file.mimetype,
        });
        uploadStream.end(file.buffer);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Image upload timeout'));
          }, 30000); // 30 second timeout

          uploadStream.on('finish', () => {
            clearTimeout(timeout);
            newImageIds.push(uploadStream.id);
            resolve();
          });
          uploadStream.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
      } catch (fileError) {
        console.error('Error uploading file:', fileError);
        throw new Error(`Failed to upload image: ${fileError.message}`);
      }
    }
    const { name, description, price, category, stock, specifications } = req.body;
    // Parse specifications from JSON string
    let parsedSpecifications;
    try {
      parsedSpecifications = JSON.parse(specifications);
    } catch (error) {
      console.error('Error parsing specifications:', error);
      parsedSpecifications = {
        material: product.specifications?.material || 'Not specified',
        color: product.specifications?.color || 'Not specified'
      };
    }
    // Ensure specifications has required fields
    const finalSpecifications = {
      material: parsedSpecifications.material || product.specifications?.material || 'Not specified',
      color: parsedSpecifications.color || product.specifications?.color || 'Not specified'
    };
    // Update product fields
    if (name) product.name = name;
    if (description) product.description = description;
    if (price) product.price = parseFloat(price);
    if (category) product.category = category;
    if (stock) product.stock = parseInt(stock) || 0;
    product.specifications = finalSpecifications;
    // Add new images if any
    if (newImageIds.length > 0) {
      product.images = [...(product.images || []), ...newImageIds];
    }
    console.log('Updating product with specifications:', finalSpecifications);
    const updatedProduct = await product.save();
    res.json({
      success: true,
      message: 'Product updated successfully',
      product: updatedProduct
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating product' });
  }
});

// Delete product
router.delete('/products/:id', isAdmin, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    // Delete product images from GridFS
    if (product.images && product.images.length > 0) {
      for (const imageId of product.images) {
        try {
          const db = mongoose.connection.db;
          const bucket = new GridFSBucket(db, { bucketName: 'uploads' });
          await bucket.delete(new ObjectId(imageId));
        } catch (err) {
          console.error('Error deleting image from GridFS:', err);
        }
      }
    }
    await Product.findByIdAndDelete(req.params.id);
    res.json({ 
      success: true, 
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Error deleting product'
    });
  }
});

// Serve images from GridFS using native GridFSBucket
router.get('/images/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid image ID' });
    }

    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available' });
    }

    const db = mongoose.connection.db;
    if (!db) {
      return res.status(503).json({ message: 'Database not initialized' });
    }

    const bucket = new GridFSBucket(db, { bucketName: 'uploads' });
    const _id = new ObjectId(req.params.id);
    
    const files = await db.collection('uploads.files').findOne({ _id });
    if (!files) {
      return res.status(404).json({ message: 'File not found' });
    }

    res.set('Content-Type', files.contentType);
    const downloadStream = bucket.openDownloadStream(_id);
    
    // Handle stream errors
    downloadStream.on('error', (err) => {
      console.error('GridFS download stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error streaming file', error: err.message });
      }
    });

    downloadStream.pipe(res);
  } catch (err) {
    console.error('Error serving image:', err);
    if (!res.headersSent) {
      res.status(500).json({ message: err.message || 'Error serving image' });
    }
  }
});

// Save payment details for an order
router.post('/orders/:orderId/payment-details', async (req, res) => {
  try {
    const { paymentDate, amount, transactionId } = req.body;
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    order.paymentDetails = {
      paymentDate,
      amount,
      transactionId,
      verified: false
    };
    await order.save();
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ message: 'Error saving payment details' });
  }
});

// Admin verifies payment
router.post('/orders/:orderId/verify-payment', async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    order.paymentDetails.verified = true;
    order.status = 'processing'; // or 'confirmed'
    await order.save();
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ message: 'Error verifying payment' });
  }
});

export default router; 