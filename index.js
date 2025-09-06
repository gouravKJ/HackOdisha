const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bcrypt = require("bcrypt");
const dotenv = require("dotenv");
const multer = require("multer");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// --- Middleware ---
app.use(cors({
  origin: process.env.CORS_ORIGINS || "*",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err.message));

// --- Health Check Endpoint ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'API is running' });
});

// --- Test Listing Endpoint ---
app.post('/api/listings', (req, res) => {
  // For testing purposes, just return the received data
  res.json({ status: 'success', message: 'Listing created successfully', data: req.body });
});

// --- Test Messages Endpoint ---
app.get('/api/messages/test', (req, res) => {
  res.json({ status: 'success', message: 'Messages API is working', data: [] });
});

// --- Schemas & Models ---
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);

const listingSchema = new mongoose.Schema({
  title: String,
  description: String,
  price: Number,
  image: String,
  images: [String],
  category: String,
  condition: String,
  location: String,
  originalPrice: Number,
  seller: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now }
});
const Listing = mongoose.model("Listing", listingSchema);

const orderSchema = new mongoose.Schema({
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  listing: { type: mongoose.Schema.Types.ObjectId, ref: "Listing" },
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model("Order", orderSchema);

const serviceSchema = new mongoose.Schema({
  name: String,
  description: String,
  price: Number,
  provider: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now }
});
const Service = mongoose.model("Service", serviceSchema);

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  message: String,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model("Message", messageSchema);

const wishlistSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  listing: { type: mongoose.Schema.Types.ObjectId, ref: "Listing" },
  createdAt: { type: Date, default: Date.now }
});
const Wishlist = mongoose.model("Wishlist", wishlistSchema);

const reviewSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  listing: { type: mongoose.Schema.Types.ObjectId, ref: "Listing" },
  rating: Number,
  comment: String,
  createdAt: { type: Date, default: Date.now }
});
const Review = mongoose.model("Review", reviewSchema);

// --- Auth Middleware ---
const auth = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).json({ message: "No token provided" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
};

// --- Multer Config ---
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// --- Routes ---
app.get("/", (req, res) => res.send("CampusXchange backend is running"));

app.get("/api", (req, res) => {
  res.json({
    message: "CampusXchange API",
    version: "1.0.0"
  });
});

// --- Auth ---
app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: "All fields required" });
  const existing = await User.findOne({ email });
  if (existing) return res.status(400).json({ message: "User already exists" });
  const hashed = await bcrypt.hash(password, 10);
  await new User({ name, email, password: hashed }).save();
  res.status(201).json({ message: "User registered successfully" });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const existing = await User.findOne({ email });
  if (!existing) return res.status(400).json({ message: "User not found" });
  const isMatch = await bcrypt.compare(password, existing.password);
  if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });
  const token = jwt.sign({ id: existing._id }, process.env.JWT_SECRET, { expiresIn: "1d" });
  res.json({ token, user: { id: existing._id, name: existing.name, email: existing.email } });
});

app.get("/api/profile", auth, async (req, res) => {
  const profile = await User.findById(req.userId).select("-password");
  res.json(profile);
});

// --- Listings ---
app.post("/api/listings", auth, upload.array("images", 5), async (req, res) => {
  const { title, description, price, category, condition, location, originalPrice } = req.body;
  const images = req.files ? req.files.map(f => f.path) : [];
  const newListing = new Listing({
    title, description, price, category, condition, location, originalPrice,
    image: images[0] || null,
    images,
    seller: req.userId
  });
  await newListing.save();
  res.status(201).json(newListing);
});

app.get("/api/listings", async (req, res) => {
  const listings = await Listing.find().populate("seller", "name email");
  res.json(listings);
});

app.get("/api/listings/:id", async (req, res) => {
  const item = await Listing.findById(req.params.id).populate("seller", "name email");
  if (!item) return res.status(404).json({ message: "Listing not found" });
  res.json(item);
});

app.put("/api/listings/:id", auth, upload.single("image"), async (req, res) => {
  const listing = await Listing.findById(req.params.id);
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.seller.toString() !== req.userId) return res.status(403).json({ message: "Unauthorized" });
  Object.assign(listing, req.body);
  if (req.file) listing.image = req.file.path;
  await listing.save();
  res.json({ message: "Listing updated", listing });
});

app.delete("/api/listings/:id", auth, async (req, res) => {
  const listing = await Listing.findById(req.params.id);
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.seller.toString() !== req.userId) return res.status(403).json({ message: "Unauthorized" });
  await listing.deleteOne();
  res.json({ message: "Listing deleted" });
});

app.get("/api/mylistings", auth, async (req, res) => {
  const listings = await Listing.find({ seller: req.userId });
  res.json(listings);
});

app.get("/api/listings/search", async (req, res) => {
  const { title, minPrice, maxPrice } = req.query;
  const query = {};
  if (title) query.title = { $regex: title, $options: "i" };
  if (minPrice) query.price = { ...query.price, $gte: Number(minPrice) };
  if (maxPrice) query.price = { ...query.price, $lte: Number(maxPrice) };
  const listings = await Listing.find(query).populate("seller", "name email");
  res.json(listings);
});

// --- Orders ---
app.post("/api/orders", auth, async (req, res) => {
  const found = await Listing.findById(req.body.listingId);
  if (!found) return res.status(404).json({ message: "Listing not found" });
  const order = new Order({ buyer: req.userId, listing: req.body.listingId });
  await order.save();
  res.status(201).json(order);
});

app.get("/api/orders", auth, async (req, res) => {
  const orders = await Order.find({ buyer: req.userId }).populate("listing").populate("buyer", "name email");
  res.json(orders);
});

// --- Services ---
app.post("/api/services", auth, async (req, res) => {
  const service = new Service({ ...req.body, provider: req.userId });
  await service.save();
  res.status(201).json(service);
});
app.get("/api/services", async (req, res) => res.json(await Service.find().populate("provider", "name email")));
app.get("/api/services/:id", async (req, res) => {
  const s = await Service.findById(req.params.id).populate("provider", "name email");
  if (!s) return res.status(404).json({ message: "Service not found" });
  res.json(s);
});

// --- Wishlist ---
app.post("/api/wishlist/:listingId", auth, async (req, res) => {
  const exists = await Wishlist.findOne({ user: req.userId, listing: req.params.listingId });
  if (exists) return res.status(400).json({ message: "Already in wishlist" });
  const item = new Wishlist({ user: req.userId, listing: req.params.listingId });
  await item.save();
  res.json(item);
});
app.get("/api/wishlist", auth, async (req, res) => res.json(await Wishlist.find({ user: req.userId }).populate("listing")));
app.delete("/api/wishlist/:listingId", auth, async (req, res) => {
  await Wishlist.deleteOne({ user: req.userId, listing: req.params.listingId });
  res.json({ message: "Removed" });
});

// --- Reviews ---
app.post("/api/reviews/:listingId", auth, async (req, res) => {
  const review = new Review({ ...req.body, user: req.userId, listing: req.params.listingId });
  await review.save();
  res.json(review);
});
app.get("/api/reviews/:listingId", async (req, res) => {
  const reviews = await Review.find({ listing: req.params.listingId }).populate("user", "name email");
  res.json(reviews);
});

// --- Admin Stats ---
app.get("/api/admin/stats", auth, async (req, res) => {
  const currentUser = await User.findById(req.userId);
  if (!currentUser.email.endsWith("@admin.com")) return res.status(403).json({ message: "Unauthorized" });
  const usersCount = await User.countDocuments();
  const listingsCount = await Listing.countDocuments();
  const ordersCount = await Order.countDocuments();
  res.json({ usersCount, listingsCount, ordersCount });
});

// --- Socket.IO Chat ---
io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);
  socket.on("join", (userId) => socket.join(userId));
  socket.on("message", async ({ sender, receiver, message }) => {
    const newMsg = new Message({ sender, receiver, message });
    await newMsg.save();
    io.to(receiver).to(sender).emit("message", newMsg);
  });
  socket.on("disconnect", () => console.log("❌ User disconnected:", socket.id));
});

app.get("/api/messages/:userId", auth, async (req, res) => {
  const messages = await Message.find({
    $or: [
      { sender: req.userId, receiver: req.params.userId },
      { sender: req.params.userId, receiver: req.userId }
    ]
  }).populate("sender receiver", "name email").sort({ createdAt: 1 });
  res.json(messages);
});

app.get("/api/conversations", auth, async (req, res) => {
  const messages = await Message.find({ $or: [{ sender: req.userId }, { receiver: req.userId }] })
    .populate("sender receiver", "name email");
  const conversations = {};
  messages.forEach(msg => {
    const other = msg.sender._id.toString() === req.userId ? msg.receiver : msg.sender;
    conversations[other._id] = { _id: other._id, name: other.name, email: other.email };
  });
  res.json(Object.values(conversations));
});

// --- Server Start ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
