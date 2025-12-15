import express from 'express';
import Slide from '../models/Slide.js';
import { adminAuth } from '../middleware/auth.js';
import multer from 'multer';
import { ObjectId, GridFSBucket } from 'mongodb';
import mongoose from 'mongoose';

const router = express.Router();

// File upload security configuration
const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const maxFileSize = 5 * 1024 * 1024; // 5MB

// File filter function
const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Only ${allowedMimeTypes.join(', ')} are allowed.`), false);
  }
};

const upload = multer({
  limits: {
    fileSize: maxFileSize
  },
  fileFilter: fileFilter
});

// Get all active slides (public route)
router.get('/', async (req, res) => {
  try {
    // Check MongoDB connection before querying
    if (mongoose.connection.readyState !== 1) {
      const connectionStates = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
      };
      const stateName = connectionStates[mongoose.connection.readyState] || 'unknown';
      console.warn(`⚠️ MongoDB connection state: ${stateName} (${mongoose.connection.readyState})`);
      return res.status(503).json({ 
        success: false, 
        message: 'Database connection unavailable. Please try again in a moment.',
        connectionState: stateName
      });
    }

    const now = new Date();
    
    // Build query for active slides with date filtering
    const query = {
      isActive: true,
      $and: [
        {
          $or: [
            { startDate: { $exists: false } },
            { startDate: null },
            { startDate: { $lte: now } }
          ]
        },
        {
          $or: [
            { endDate: { $exists: false } },
            { endDate: null },
            { endDate: { $gte: now } }
          ]
        }
      ]
    };
    
    console.log('📸 Fetching slides with query:', JSON.stringify(query, null, 2));
    
    const slides = await Slide.find(query)
      .sort({ order: 1, createdAt: -1 })
      .select('-createdBy');

    console.log(`📸 Found ${slides.length} active slide(s)`);
    
    res.json({ success: true, slides });
  } catch (error) {
    console.error('Error fetching slides:', error);
    res.status(500).json({ success: false, message: 'Error fetching slides' });
  }
});

// Get all slides (admin only)
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    // Check MongoDB connection before querying
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connection unavailable. Please try again in a moment.'
      });
    }

    const slides = await Slide.find()
      .sort({ order: 1, createdAt: -1 })
      .populate('createdBy', 'name email');

    res.json({ success: true, slides });
  } catch (error) {
    console.error('Error fetching all slides:', error);
    res.status(500).json({ success: false, message: 'Error fetching slides' });
  }
});

// Get single slide (admin only)
router.get('/admin/:id', adminAuth, async (req, res) => {
  try {
    const slide = await Slide.findById(req.params.id);
    if (!slide) {
      return res.status(404).json({ success: false, message: 'Slide not found' });
    }
    res.json({ success: true, slide });
  } catch (error) {
    console.error('Error fetching slide:', error);
    res.status(500).json({ success: false, message: 'Error fetching slide' });
  }
});

// Create slide (admin only)
router.post('/admin', adminAuth, upload.single('image'), async (req, res) => {
  try {
    const { title, description, link, linkText, isActive, order, startDate, endDate } = req.body;
    
    if (!title) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    let imageId = null;
    
    // Handle image upload to GridFS
    if (req.file) {
      try {
        // Validate file
        if (req.file.size > maxFileSize) {
          return res.status(400).json({ success: false, message: `File exceeds maximum size of ${maxFileSize / 1024 / 1024}MB` });
        }
        
        if (!allowedMimeTypes.includes(req.file.mimetype)) {
          return res.status(400).json({ success: false, message: 'Invalid file type. Only images are allowed.' });
        }

        // Check if MongoDB is connected
        if (mongoose.connection.readyState !== 1) {
          return res.status(503).json({ success: false, message: 'Database connection not available. Please try again.' });
        }

        const db = mongoose.connection.db;
        if (!db) {
          return res.status(503).json({ success: false, message: 'Database not initialized' });
        }

        const bucket = new GridFSBucket(db, { bucketName: 'uploads' });
        
        // Sanitize filename to prevent path traversal
        const sanitizedFilename = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const timestamp = Date.now();
        const finalFilename = `${timestamp}_${sanitizedFilename}`;
        
        const uploadStream = bucket.openUploadStream(finalFilename, {
          contentType: req.file.mimetype,
        });
        
        uploadStream.end(req.file.buffer);
        
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Image upload timeout'));
          }, 30000); // 30 second timeout

          uploadStream.on('finish', () => {
            clearTimeout(timeout);
            imageId = uploadStream.id.toString();
            resolve();
          });
          uploadStream.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
      } catch (error) {
        console.error('Error uploading image to GridFS:', error);
        return res.status(500).json({ 
          success: false, 
          message: 'Error uploading image. Please check your database connection and try again.',
          error: error.message 
        });
      }
    } else if (req.body.image) {
      // If image is provided as URL or existing ID
      imageId = req.body.image;
    } else {
      return res.status(400).json({ success: false, message: 'Image is required' });
    }

    const slide = new Slide({
      title,
      description,
      image: imageId,
      link,
      linkText: linkText || 'Shop Now',
      isActive: isActive !== undefined ? isActive === 'true' : true,
      order: order ? parseInt(order) : 0,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      createdBy: req.user._id
    });

    await slide.save();
    res.status(201).json({ success: true, slide });
  } catch (error) {
    console.error('Error creating slide:', error);
    res.status(500).json({ success: false, message: 'Error creating slide', error: error.message });
  }
});

// Update slide (admin only)
router.put('/admin/:id', adminAuth, upload.single('image'), async (req, res) => {
  try {
    const slide = await Slide.findById(req.params.id);
    if (!slide) {
      return res.status(404).json({ success: false, message: 'Slide not found' });
    }

    const { title, description, link, linkText, isActive, order, startDate, endDate } = req.body;

    if (title) slide.title = title;
    if (description !== undefined) slide.description = description;
    if (link !== undefined) slide.link = link;
    if (linkText !== undefined) slide.linkText = linkText;
    if (isActive !== undefined) slide.isActive = isActive === 'true' || isActive === true;
    if (order !== undefined) slide.order = parseInt(order);
    if (startDate !== undefined) slide.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) slide.endDate = endDate ? new Date(endDate) : null;

    // Handle new image upload
    if (req.file) {
      try {
        // Validate file
        if (req.file.size > maxFileSize) {
          return res.status(400).json({ success: false, message: `File exceeds maximum size of ${maxFileSize / 1024 / 1024}MB` });
        }
        
        if (!allowedMimeTypes.includes(req.file.mimetype)) {
          return res.status(400).json({ success: false, message: 'Invalid file type. Only images are allowed.' });
        }

        // Check if MongoDB is connected
        if (mongoose.connection.readyState !== 1) {
          return res.status(503).json({ success: false, message: 'Database connection not available. Please try again.' });
        }

        const db = mongoose.connection.db;
        if (!db) {
          return res.status(503).json({ success: false, message: 'Database not initialized' });
        }

        const bucket = new GridFSBucket(db, { bucketName: 'uploads' });
        
        // Delete old image if it exists
        if (slide.image && ObjectId.isValid(slide.image)) {
          try {
            await bucket.delete(new ObjectId(slide.image));
          } catch (err) {
            console.error('Error deleting old image:', err);
            // Continue even if deletion fails
          }
        }
        
        // Sanitize filename to prevent path traversal
        const sanitizedFilename = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const timestamp = Date.now();
        const finalFilename = `${timestamp}_${sanitizedFilename}`;
        
        const uploadStream = bucket.openUploadStream(finalFilename, {
          contentType: req.file.mimetype,
        });
        
        uploadStream.end(req.file.buffer);
        
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Image upload timeout'));
          }, 30000); // 30 second timeout

          uploadStream.on('finish', () => {
            clearTimeout(timeout);
            slide.image = uploadStream.id.toString();
            resolve();
          });
          uploadStream.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
      } catch (error) {
        console.error('Error uploading image to GridFS:', error);
        return res.status(500).json({ 
          success: false, 
          message: 'Error uploading image. Please check your database connection and try again.',
          error: error.message 
        });
      }
    } else if (req.body.image) {
      slide.image = req.body.image;
    }

    await slide.save();
    res.json({ success: true, slide });
  } catch (error) {
    console.error('Error updating slide:', error);
    res.status(500).json({ success: false, message: 'Error updating slide', error: error.message });
  }
});

// Delete slide (admin only)
router.delete('/admin/:id', adminAuth, async (req, res) => {
  try {
    const slide = await Slide.findById(req.params.id);
    if (!slide) {
      return res.status(404).json({ success: false, message: 'Slide not found' });
    }

    // Delete image from GridFS if it exists
    if (slide.image && ObjectId.isValid(slide.image)) {
      try {
        // Check if MongoDB is connected
        if (mongoose.connection.readyState === 1) {
          const db = mongoose.connection.db;
          if (db) {
            const bucket = new GridFSBucket(db, { bucketName: 'uploads' });
            await bucket.delete(new ObjectId(slide.image));
          }
        }
      } catch (err) {
        console.error('Error deleting image:', err);
        // Continue with slide deletion even if image deletion fails
      }
    }

    await slide.deleteOne();
    res.json({ success: true, message: 'Slide deleted successfully' });
  } catch (error) {
    console.error('Error deleting slide:', error);
    res.status(500).json({ success: false, message: 'Error deleting slide' });
  }
});

export default router;

