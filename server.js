// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());

// uploads folder
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// ---------------------------
// MongoDB
// ---------------------------
const MONGO_URI = process.env.MONGO_URI || 
'mongodb+srv://Cloud_9_Pastries:Cloud9Pastries@cluster0.ti5jzez.mongodb.net/bakerydb';

mongoose
  .connect(MONGO_URI)   
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// ---------------------------
// email
// ---------------------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  }
});


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
  screenshot: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

const ProductSchema = new mongoose.Schema({
  name: String,
  description: String,
  price: Number,
  category: String,
  image: String,
  available: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const Product = mongoose.model('Product', ProductSchema);

// ---------------------------
// Multer
// ---------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

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

// DELETE order
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id).exec();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.screenshot) {
      const filePath = path.join(__dirname, order.screenshot);
      fs.unlink(filePath, () => {});
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
// 🚀 PLACE ORDER + SEND EMAIL
// ---------------------------
app.post('/api/place-order', upload.single('screenshot'), async (req, res) => {
  try {
    const {
      fullName, email, phone, address, city, pincode, paymentMethod, cart, total, landmark
    } = req.body;

    const order = new Order({
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
      screenshot: req.file ? '/uploads/' + req.file.filename : null
    });

    await order.save();

// ---------------------------
// SEND EMAIL TO USER
// ---------------------------
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
    `
  });

  console.log("📧 Email sent successfully via Gmail!");
} catch (err) {
  console.log("❌ Email Error:", err);
}

    res.json({ success: true, orderId: order._id });

  } catch (err) {
    console.log("place-order error:", err);
    res.status(500).json({ success: false });
  }
});

// ---------------------------
// Products routes
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

app.post('/api/products', upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category } = req.body;
    if (!name || !price) return res.status(400).json({ success: false, message: 'Name & price required' });

    const product = new Product({
      name,
      description: description || '',
      price: Number(price),
      category: category || '',
      image: req.file ? '/uploads/' + req.file.filename : null
    });
    await product.save();
    res.json({ success: true, product });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error creating product' });
  }
});

app.put('/api/products/:id', upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category, available } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (price !== undefined) update.price = Number(price);
    if (category !== undefined) update.category = category;
    if (available !== undefined) update.available = (available === 'true' || available === true);

    if (req.file) update.image = '/uploads/' + req.file.filename;

    const old = await Product.findById(req.params.id).exec();
    if (!old) return res.status(404).json({ success: false, message: 'Product not found' });

    if (req.file && old.image) {
      fs.unlink(path.join(__dirname, old.image), () => {});
    }

    const updated = await Product.findByIdAndUpdate(req.params.id, update, { new: true }).exec();
    res.json({ success: true, product: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error updating product' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const p = await Product.findByIdAndDelete(req.params.id).exec();
    if (!p) return res.status(404).json({ success: false, message: 'Product not found' });

    if (p.image) {
      fs.unlink(path.join(__dirname, p.image), () => {});
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
