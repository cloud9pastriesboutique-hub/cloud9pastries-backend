// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

// Cloudinary + Multer storage
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json());

const Brevo = require("@getbrevo/brevo");

const brevoAPI = new Brevo.TransactionalEmailsApi();
brevoAPI.setApiKey(
  Brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY
);


// ---------------------------
// MongoDB
// ---------------------------
const MONGO_URI = process.env.MONGO_URI || 'your_fallback_mongo_uri_here';
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// ---------------------------
// Email (Gmail - App Password)
// ---------------------------
/*const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});*/

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
  options: { type: Array, default: [] },
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
// 🚀 PLACE ORDER + SEND EMAIL TO USER + OWNER
// ---------------------------
app.post('/api/place-order', upload.single('screenshot'), async (req, res) => {
  try {
    const {
      fullName, email, phone, address, city, pincode,
      paymentMethod, cart, total, landmark
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

    // Screenshot (optional)
    if (req.file) {
      orderData.screenshotUrl = req.file.path || req.file.url;
      orderData.screenshotPublicId = req.file.filename || req.file.public_id;
    }

    const order = new Order(orderData);
    await order.save();

    // ---------------------------------------------------------
    // 📧 EMAIL TO USER (Confirmation email)
    // ---------------------------------------------------------
    try {
      await brevoAPI.sendTransacEmail({
        sender: { name: "Cloud 9 Pastries", email: process.env.SENDER_EMAIL },
        to: [{ email: email, name: fullName }],
        subject: "Order Confirmation - Cloud 9 Pastries",
        htmlContent: `
          <h2>Hi ${fullName},</h2>
          <p>Thank you for your order!</p>
          <p><strong>Total Amount:</strong> ₹${total}</p>
          <p>We will contact you shortly.</p>
        `
      });

      console.log("📧 Confirmation mail sent to user.");
    } catch (err) {
      console.log("❌ User email error:", err.message);
    }

    // ---------------------------------------------------------
    // 📧 EMAIL TO OWNER (New order notification)
    // ---------------------------------------------------------
    try {
      const itemsHTML = orderData.cart.map(i => `
        <p>${i.name} × ${i.quantity} — ₹${i.price}</p>
      `).join('');

      await brevoAPI.sendTransacEmail({
        sender: { name: "Cloud 9 Pastries", email: process.env.SENDER_EMAIL },
        to: [{ email: process.env.OWNER_EMAIL, name: "Cloud 9 Owner" }],
        subject: "New Order Received - Cloud 9 Pastries",
        htmlContent: `
          <h2>New Order Received</h2>
          <p><strong>Name:</strong> ${fullName}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Phone:</strong> ${phone}</p>
          <p><strong>Address:</strong> ${address}, ${city} - ${pincode}</p>
          <p><strong>Payment:</strong> ${paymentMethod}</p>
          <p><strong>Total:</strong> ₹${total}</p>

          <h3>Items Ordered:</h3>
          ${itemsHTML}

          <h3>Screenshot:</h3>
          ${
            orderData.screenshotUrl
              ? `<img src="${orderData.screenshotUrl}" width="250" />`
              : "<p>No screenshot uploaded.</p>"
          }

          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        `
      });

      console.log("📧 Owner notified.");
    } catch (err) {
      console.log("❌ Owner email error:", err.message);
    }

    // Final response
    res.json({ success: true, orderId: order._id });

  } catch (err) {
    console.log("❌ place-order error:", err);
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

     const optionsArray = req.body.options
  ? req.body.options.split(",").map(o => o.trim())
  : [];

    const product = new Product({
      name,
      description: description || '',
      price: Number(price),
      category: category || '',
      options: optionsArray,
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
    if (req.body.options !== undefined) {
    update.options = req.body.options.split(",").map(o => o.trim());}
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

// TOGGLE HOLD / UNHOLD PRODUCT
app.put("/api/products/:id/toggle-hold", async (req, res) => {
  try {
    const p = await Product.findById(req.params.id);
    if (!p) return res.json({ success: false, message: "Product not found" });

    p.available = !p.available;   // flip true/false
    await p.save();

    res.json({ success: true, available: p.available });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// ---------------------------
// 📩 CONTACT FORM — SEND EMAIL TO OWNER
// ---------------------------
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    // Email content for owner
    const html = `
      <h2>New Contact Inquiry</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Subject:</strong> ${subject || "No subject provided"}</p>
      <p><strong>Message:</strong></p>
      <p>${message}</p>
      <br/>
      <p><em>Sent from Cloud 9 Pastries Contact Page</em></p>
    `;

    await brevoAPI.sendTransacEmail({
      sender: { name: "Cloud 9 Pastries Website", email: process.env.SENDER_EMAIL },
      to: [{ email: process.env.OWNER_EMAIL, name: "Cloud 9 Owner" }],
      subject: `New Inquiry From ${name}`,
      htmlContent: html
    });

    res.json({ success: true, message: "Message sent successfully!" });

  } catch (err) {
    console.log("❌ Contact form email error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// ---------------------------
// start server
// ---------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
