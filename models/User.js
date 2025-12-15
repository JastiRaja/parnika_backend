import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const addressSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true
  },
  addressLine1: {
    type: String,
    required: true
  },
  addressLine2: String,
  city: {
    type: String,
    required: true
  },
  state: {
    type: String,
    required: true
  },
  pincode: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  isDefault: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters long'],
    validate: {
      validator: function(v) {
        // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
        return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(v);
      },
      message: 'Password must be at least 8 characters and contain uppercase, lowercase, and number'
    }
  },
  phone: {
    type: String,
    required: false
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  addresses: [addressSchema],
  bankDetails: {
    accountName: String,
    accountNumber: String,
    bankName: String,
    ifscCode: String,
    upiId: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  otp: String,
  otpExpires: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'users', // Explicitly set collection name
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    if (this.isModified('addresses')) {
      const defaultAddresses = this.addresses.filter(addr => addr.isDefault);
      if (defaultAddresses.length > 1) {
        // Keep only the last default address
        const lastDefaultIndex = this.addresses.map(addr => addr.isDefault).lastIndexOf(true);
        this.addresses.forEach((addr, index) => {
          if (index !== lastDefaultIndex) {
            addr.isDefault = false;
          }
        });
      }
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Method to mask phone number
userSchema.methods.getMaskedPhone = function() {
  if (!this.phone) return '';
  const last4 = this.phone.slice(-4);
  return 'x'.repeat(this.phone.length - 4) + last4;
};

const User = mongoose.model('User', userSchema);

export default User; 