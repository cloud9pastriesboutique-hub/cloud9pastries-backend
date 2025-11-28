// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');

// Cloudinary + Multer storage
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------
// MongoDB
// ---------------------------
const MONGO_URI = process.env.MONGO_URI || 'your_fallback_mongo_uri_here';
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB Connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// ---------------------------
// Email (Gmail - App Password)
// ---------------------------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// ---------------------------
// Cloudinary config + Multer storage
// ---------------------------
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
});

// Cloudinary storage config - sets a public_id we can later delete
const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    // file.fieldname often 'image' or 'screenshot' — helps group assets
    const timestamp = Date.now();
    const public_id = `${file.fieldname}_${timestamp}`;
    return {
      folder: 'cloud9pastries',
      public_id,
      allowed_formats: ['jpg', 'jpeg', 'png'],
    };
  },
});

const upload = multer({ storage });

// ---------------------------
// Schemas
// ---------------------------
const OrderSchema = new mongoose.Schema({
  fullName: String,
  email: String,
  phone: String,
  address: String,
  landmark: String,
  city: String,
  pincode: String,
  paymentMethod: String,
  cart: { type: Array, default: [] },
  total: { type: Number, default: 0 },
  screenshotUrl: String,       // Cloudinary URL
  screenshotPublicId: String,  // Cloudinary public_id (for deletions)
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now },
});
const Order = mongoose.model('Order', OrderSchema);

const ProductSchema = new mongoose.Schema({
  name: String,
  description: String,
  price: Number,
  category: String,
  imageUrl: String,       // Cloudinary URL
  imagePublicId: String,  // Cloudinary public_id
  available: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});
const Product = mongoose.model('Product', ProductSchema);

// ---------------------------
// Orders routes
// ---------------------------

// GET all orders
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ createdAt: -1 }).exec();
    res.json({ success: true, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error fetching orders' });
  }
});

// GET single order
app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).exec();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error fetching order' });
  }
});

// DELETE order (also delete screenshot from Cloudinary if exists)
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id).exec();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.screenshotPublicId) {
      cloudinary.uploader.destroy(order.screenshotPublicId, (err, result) => {
        if (err) console.error('Cloudinary delete order screenshot error:', err);
      });
    }

    res.json({ success: true, message: 'Order deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error deleting order' });
  }
});

// Update order status
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    await Order.findByIdAndUpdate(req.params.id, { status }).exec();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// ---------------------------
// 🚀 PLACE ORDER + SEND EMAIL (screenshot via Cloudinary)
// ---------------------------
// Accepts a 'screenshot' file field (optional)
app.post('/api/place-order', upload.single('screenshot'), async (req, res) => {
  try {
    const {
      fullName, email, phone, address, city, pincode, paymentMethod, cart, total, landmark
    } = req.body;

    const orderData = {
      fullName,
      email,
      phone,
      address,
      landmark,
      city,
      pincode,
      paymentMethod,
      cart: cart ? JSON.parse(cart) : [],
      total: Number(total),
    };

    if (req.file) {
      // multer-storage-cloudinary returns file.path (URL) and file.filename (public_id)
      orderData.screenshotUrl = req.file.path || req.file.url;
      orderData.screenshotPublicId = req.file.filename || req.file.public_id;
    }

    const order = new Order(orderData);
    await order.save();

    // SEND EMAIL TO USER
    try {
      await transporter.sendMail({
        from: `"Cloud 9 Pastries" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `Order Confirmation - Cloud 9 Pastries`,
        html: `
          <h2>Hi ${fullName},</h2>
          <p>Thank you for your order!</p>
          <p><strong>Total Amount:</strong> ₹${total}</p>
          <p>We will contact you shortly.</p>
        `,
      });
      console.log('📧 Email sent successfully via Gmail!');
    } catch (err) {
      console.log('❌ Email Error:', err);
    }

    res.json({ success: true, orderId: order._id });
  } catch (err) {
    console.log('place-order error:', err);
    res.status(500).json({ success: false });
  }
});

// ---------------------------
// Products routes (images via Cloudinary)
// ---------------------------

app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find({}).sort({ createdAt: -1 }).exec();
    res.json({ success: true, products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const p = await Product.findById(req.params.id).exec();
    if (!p) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, product: p });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// Create product (image field name: 'image')
app.post('/api/products', upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category } = req.body;
    if (!name || !price) return res.status(400).json({ success: false, message: 'Name & price required' });

    const product = new Product({
      name,
      description: description || '',
      price: Number(price),
      category: category || '',
    });

    if (req.file) {
      product.imageUrl = req.file.path || req.file.url;
      product.imagePublicId = req.file.filename || req.file.public_id;
    }

    await product.save();
    res.json({ success: true, product });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error creating product' });
  }
});

// Update product (replace image if provided and delete old Cloudinary asset)
app.put('/api/products/:id', upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category, available } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (price !== undefined) update.price = Number(price);
    if (category !== undefined) update.category = category;
    if (available !== undefined) update.available = (available === 'true' || available === true);

    const old = await Product.findById(req.params.id).exec();
    if (!old) return res.status(404).json({ success: false, message: 'Product not found' });

    // If new image uploaded, delete old asset then set new
    if (req.file) {
      // delete old Cloudinary asset if exists
      if (old.imagePublicId) {
        cloudinary.uploader.destroy(old.imagePublicId, (err, resu) => {
          if (err) console.error('Cloudinary delete old product image error:', err);
        });
      }
      update.imageUrl = req.file.path || req.file.url;
      update.imagePublicId = req.file.filename || req.file.public_id;
    }

    const updated = await Product.findByIdAndUpdate(req.params.id, update, { new: true }).exec();
    res.json({ success: true, product: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error updating product' });
  }
});

// Delete product (also delete image from Cloudinary)
app.delete('/api/products/:id', async (req, res) => {
  try {
    const p = await Product.findByIdAndDelete(req.params.id).exec();
    if (!p) return res.status(404).json({ success: false, message: 'Product not found' });

    if (p.imagePublicId) {
      cloudinary.uploader.destroy(p.imagePublicId, (err, result) => {
        if (err) console.error('Cloudinary delete product image error:', err);
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error deleting product' });
  }
});

// ---------------------------
// start server
// ---------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
