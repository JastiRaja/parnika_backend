import mongoose from 'mongoose';
import Product from '../models/Product.js';
import dotenv from 'dotenv';

dotenv.config();

const fixImagePaths = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/parnika_silks');
    console.log('Connected to MongoDB');

    const products = await Product.find();
    console.log(`Found ${products.length} products`);

    let updatedCount = 0;

    for (const product of products) {
      const updatedImages = product.images.map(imagePath => {
        if (imagePath.startsWith('/uploads/') && !imagePath.includes('/products/')) {
          return imagePath.replace('/uploads/', '/uploads/products/');
        }
        return imagePath;
      });

      if (JSON.stringify(updatedImages) !== JSON.stringify(product.images)) {
        product.images = updatedImages;
        await product.save();
        updatedCount++;
      }
    }

    console.log(`Updated ${updatedCount} products`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
};

fixImagePaths(); 