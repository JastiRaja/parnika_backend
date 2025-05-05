import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import Product from '../models/Product.js';
import { auth, adminAuth } from '../middleware/auth.js';
import fs from 'fs';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
import { mkdir } from 'fs/promises';
try {
  await mkdir(uploadsDir, { recursive: true });
} catch (error) {
  console.error('Error creating uploads directory:', error);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/products';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Get all products
router.get('/', async (req, res) => {
  try {
    const { category, sort, search } = req.query;
    let query = {};

    if (category) {
      query.category = category;
    }

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    let sortOption = {};
    if (sort === 'price_asc') {
      sortOption = { price: 1 };
    } else if (sort === 'price_desc') {
      sortOption = { price: -1 };
    } else {
      sortOption = { createdAt: -1 };
    }

    const products = await Product.find(query).sort(sortOption);
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching products' });
  }
});

// Get single product
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    // Convert to plain object and ensure all fields are properly formatted
    const transformedProduct = {
      _id: product._id.toString(),
      name: product.name,
      description: product.description,
      price: product.price,
      category: product.category,
      stock: product.stock,
      images: product.images,
      specifications: {
        material: product.specifications?.material || 'Not specified',
        color: product.specifications?.color || 'Not specified'
      },
      averageRating: product.averageRating || 0,
      totalReviews: product.totalReviews || 0,
      createdAt: product.createdAt
    };

    res.json({ success: true, product: transformedProduct });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ success: false, message: 'Error fetching product' });
  }
});

// Get products by category
router.get('/category/:category', async (req, res) => {
  try {
    const products = await Product.find({ category: req.params.category });
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching products' });
  }
});

// Search products
router.get('/search/:query', async (req, res) => {
  try {
    const products = await Product.find({
      name: { $regex: req.params.query, $options: 'i' }
    });
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error searching products' });
  }
});

// Admin: Add new product
router.post('/', adminAuth, upload.array('images', 5), async (req, res) => {
  try {
    const { name, description, price, category, stock } = req.body;
    
    if (!name || !description || !price || !category || !stock) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Handle specifications as a nested object
    const specifications = {};
    Object.keys(req.body).forEach(key => {
      if (key.startsWith('specifications[')) {
        const specKey = key.replace('specifications[', '').replace(']', '');
        specifications[specKey] = req.body[key];
      }
    });

    const images = req.files.map(file => `/uploads/products/${file.filename}`);
    
    const product = new Product({
      name,
      description,
      price: parseFloat(price),
      category,
      stock: parseInt(stock),
      specifications,
      images
    });

    const savedProduct = await product.save();
    res.status(201).json(savedProduct);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Admin: Update product
router.put('/:id', adminAuth, upload.array('images', 5), async (req, res) => {
  try {
    const { name, description, price, category, stock } = req.body;
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Handle specifications as a nested object
    const specifications = {};
    Object.keys(req.body).forEach(key => {
      if (key.startsWith('specifications[')) {
        const specKey = key.replace('specifications[', '').replace(']', '');
        specifications[specKey] = req.body[key];
      }
    });

    if (name) product.name = name;
    if (description) product.description = description;
    if (price) product.price = parseFloat(price);
    if (category) product.category = category;
    if (stock) product.stock = parseInt(stock);
    if (Object.keys(specifications).length > 0) product.specifications = specifications;
    
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map(file => `/uploads/products/${file.filename}`);
      product.images = [...product.images, ...newImages];
    }

    const updatedProduct = await product.save();
    res.json(updatedProduct);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Admin: Delete product (soft delete)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    product.isActive = false;
    await product.save();
    
    res.json({ message: 'Product deactivated successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add review to product
router.post('/:id/reviews', auth, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const review = {
      user: req.user._id,
      rating: parseInt(rating),
      comment
    };

    product.reviews.push(review);
    product.calculateAverageRating();
    
    await product.save();
    res.status(201).json(product);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router; 