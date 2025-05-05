import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Product from '../models/Product.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

async function updateProducts() {
  try {
    // Find all products
    const products = await Product.find({});
    console.log(`Found ${products.length} products`);

    // Update each product
    let updatedCount = 0;
    for (const product of products) {
      // Check if product has specifications
      if (!product.specifications) {
        product.specifications = {
          material: 'Not specified',
          color: 'Not specified'
        };
        await product.save();
        updatedCount++;
      }
    }

    console.log(`Updated ${updatedCount} products`);
    process.exit(0);
  } catch (error) {
    console.error('Error updating products:', error);
    process.exit(1);
  }
}

updateProducts(); 