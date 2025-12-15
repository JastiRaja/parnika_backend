import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import orderRoutes from './routes/orders.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import emailRoutes from './routes/email.js';
import customerRoutes from './routes/customers.js';
import slideRoutes from './routes/slides.js';

// Load environment variables
dotenv.config();

// Disable mongoose buffering globally - fail fast if not connected
mongoose.set('bufferCommands', false);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security Headers - Helmet.js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding if needed
  crossOriginResourcePolicy: { policy: "cross-origin" } // Allow images from other origins
}));

// Rate Limiting - General API rate limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many authentication attempts, please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
});

// Apply general rate limiting to all routes
app.use('/api/', generalLimiter);

// Middleware - CORS Configuration
const allowedOrigins = process.env.FRONTEND_URL 
  ? (Array.isArray(process.env.FRONTEND_URL) 
      ? process.env.FRONTEND_URL 
      : process.env.FRONTEND_URL.split(',').map(url => url.trim()))
  : ['http://localhost:3000', 'http://localhost:5173', 'https://parnikasilks.vercel.app'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));
// Body parser with reasonable limits
app.use(express.json({ limit: '10mb' })); // Reduced from 50mb for security
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static files
app.use('/uploads/products', express.static(path.join(__dirname, 'uploads/products')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes - Apply auth rate limiting to auth routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/slides', slideRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  
  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'Something went wrong!' 
    : err.message;
  
  res.status(err.status || 500).json({ 
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    message: 'Route not found' 
  });
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
const productsDir = path.join(__dirname, 'uploads', 'products');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Created uploads directory:', uploadsDir);
}

if (!fs.existsSync(productsDir)) {
  fs.mkdirSync(productsDir, { recursive: true });
  console.log('Created products uploads directory:', productsDir);
}

// Ensure proper permissions
try {
  fs.chmodSync(uploadsDir, '755');
  fs.chmodSync(productsDir, '755');
  console.log('Set proper permissions for upload directories');
} catch (error) {
  console.error('Error setting directory permissions:', error);
}

// Connect to MongoDB with improved connection options
const mongooseOptions = {
  serverSelectionTimeoutMS: 30000, // 30 seconds
  socketTimeoutMS: 45000, // 45 seconds
  connectTimeoutMS: 30000, // 30 seconds
  maxPoolSize: 10, // Maximum number of connections in the pool
  minPoolSize: 2, // Minimum number of connections in the pool
  maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
  retryWrites: true,
  retryReads: true,
  heartbeatFrequencyMS: 10000, // Check server status every 10 seconds
};

// Function to connect to MongoDB with retry logic
const connectToMongoDB = async (retries = 3) => {
  const mongoUri = process.env.MONGODB_URI;
  
  if (!mongoUri) {
    console.error('❌ MONGODB_URI environment variable is not set!');
    console.error('Please add MONGODB_URI to your .env file');
    return false;
  }

  // Extract cluster info from URI for better error messages
  const clusterMatch = mongoUri.match(/mongodb\+srv:\/\/([^:]+):([^@]+)@([^/]+)\//);
  const clusterInfo = clusterMatch ? clusterMatch[3] : 'unknown';

  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(mongoUri, mongooseOptions);
      console.log('✅ Connected to MongoDB successfully');
      console.log('MongoDB connection state:', mongoose.connection.readyState);
      console.log('Database:', mongoose.connection.db?.databaseName || 'unknown');
      return true;
    } catch (err) {
      const isLastAttempt = i === retries - 1;
      console.error(`❌ MongoDB connection attempt ${i + 1}/${retries} failed:`, err.message);
      
      if (isLastAttempt) {
        console.error('\n' + '='.repeat(60));
        console.error('❌ All MongoDB connection attempts failed');
        console.error('='.repeat(60));
        console.error('\n📋 Error Details:');
        console.error('Error Type:', err.name);
        console.error('Error Message:', err.message);
        
        if (err.message.includes('whitelist') || err.message.includes('IP')) {
          console.error('\n🔒 IP WHITELIST ISSUE DETECTED');
          console.error('Your IP address is not whitelisted in MongoDB Atlas.');
          console.error('\n📝 How to fix:');
          console.error('1. Go to MongoDB Atlas: https://cloud.mongodb.com/');
          console.error('2. Navigate to: Network Access → IP Access List');
          console.error('3. Click "Add IP Address"');
          console.error('4. Option A: Add your current IP (click "Add Current IP Address")');
          console.error('5. Option B: Allow all IPs (for development): Add "0.0.0.0/0"');
          console.error('   ⚠️  WARNING: Only use 0.0.0.0/0 for development, not production!');
          console.error('6. Wait 1-2 minutes for changes to propagate');
          console.error('7. Restart your server');
        } else if (err.message.includes('authentication') || err.message.includes('password')) {
          console.error('\n🔐 AUTHENTICATION ISSUE DETECTED');
          console.error('Your MongoDB credentials may be incorrect.');
          console.error('\n📝 How to fix:');
          console.error('1. Check your MONGODB_URI in the .env file');
          console.error('2. Verify your MongoDB Atlas username and password');
          console.error('3. Make sure the database user has proper permissions');
        } else if (err.message.includes('timeout') || err.message.includes('ETIMEDOUT')) {
          console.error('\n⏱️  CONNECTION TIMEOUT DETECTED');
          console.error('The connection to MongoDB Atlas is timing out.');
          console.error('\n📝 How to fix:');
          console.error('1. Check your internet connection');
          console.error('2. Verify MongoDB Atlas cluster is running');
          console.error('3. Check if your firewall is blocking the connection');
          console.error('4. Try increasing timeout values in mongooseOptions');
        }
        
        console.error('\n📋 General Checklist:');
        console.error('✓ MongoDB Atlas cluster is running');
        console.error('✓ Your IP is whitelisted in Network Access');
        console.error('✓ MONGODB_URI is correct in .env file');
        console.error('✓ Database user has read/write permissions');
        console.error('✓ Internet connection is stable');
        console.error('✓ No firewall blocking port 27017');
        console.error('\n' + '='.repeat(60) + '\n');
      } else {
        console.log(`⏳ Retrying connection in 5 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  return false;
};

// Initial connection
connectToMongoDB();

// Handle connection events
mongoose.connection.on('connected', () => {
  console.log('✅ Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ Mongoose disconnected from MongoDB');
  console.log('🔄 Attempting to reconnect...');
  // Attempt to reconnect after 5 seconds
  setTimeout(() => {
    if (mongoose.connection.readyState === 0) {
      connectToMongoDB(1);
    }
  }, 5000);
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ Mongoose reconnected to MongoDB');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('MongoDB connection closed through app termination');
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});