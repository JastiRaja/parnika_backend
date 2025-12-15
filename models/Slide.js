import mongoose from 'mongoose';

const slideSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Slide title is required'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  image: {
    type: String,
    required: [true, 'Slide image is required']
  },
  link: {
    type: String,
    trim: true
  },
  linkText: {
    type: String,
    default: 'Shop Now'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  },
  startDate: {
    type: Date
  },
  endDate: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for active slides ordered by order field
slideSchema.index({ isActive: 1, order: 1 });

const Slide = mongoose.model('Slide', slideSchema);

export default Slide;





