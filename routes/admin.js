import express from 'express';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { GridFsStorage } from 'multer-gridfs-storage';
import { ObjectId, GridFSBucket } from 'mongodb';
import mongoose from 'mongoose';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure GridFS storage for multer
const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/parnika_silks';
const storage = new GridFsStorage({
  url: mongoURI,
  file: (req, file) => ({
    filename: `product_${Date.now()}_${file.originalname}`,
    bucketName: 'uploads'
  })
});
const upload = multer({ storage });

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
    // Store GridFS file IDs
    const images = req.files.map(file => file.id);
    const product = new Product({
      name,
      description,
      price: parseFloat(price),
      category,
      stock: parseInt(stock) || 0,
      specifications: finalSpecifications,
      images
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
    const { name, description, price, category, stock, specifications } = req.body;
    
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

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

    // Process new image IDs for new uploads
    const newImageIds = req.files.map(file => file.id);
    // Update product fields
    if (name) product.name = name;
    if (description) product.description = description;
    if (price) product.price = parseFloat(price);
    if (category) product.category = category;
    if (stock) product.stock = parseInt(stock) || 0;
    product.specifications = finalSpecifications;
    // Add new images if any
    if (newImageIds.length > 0) {
      product.images = [...product.images, ...newImageIds];
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
          await gfs.files.deleteOne({ _id: imageId });
          await gfs.db.collection('uploads.chunks').deleteMany({ files_id: imageId });
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
    const db = mongoose.connection.db;
    const bucket = new GridFSBucket(db, { bucketName: 'uploads' });
    const _id = new ObjectId(req.params.id);
    const files = await db.collection('uploads.files').findOne({ _id });
    if (!files) return res.status(404).json({ message: 'File not found' });
    res.set('Content-Type', files.contentType);
    const downloadStream = bucket.openDownloadStream(_id);
    downloadStream.pipe(res);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router; 