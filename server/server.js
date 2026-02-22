const express = require("express");
const cors = require("cors");

const mongoose = require("mongoose");

require("dotenv").config();
const app = express();

// Health first – no middleware, so nothing can block the response
app.get("/api/health", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.status(200).end(JSON.stringify({ ok: true }));
});

// Allow requests from Angular (localhost:4200)
app.use(cors());
app.use(express.json());

// Log every request (so we see in server terminal when curl hits)
app.use((req, res, next) => {
  console.log(req.method, req.url);
  next();
});

// Mongo connection
//const MONGO_URL = "mongodb://127.0.0.1:27017/measurements_db";
const MONGO_URL = process.env.MONGO_URL;

mongoose
  .connect(MONGO_URL)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Schema (1 collection)
const MeasurementSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["LineString", "Polygon"], required: true },
    geojson: { type: Object, required: true }, // GeoJSON Feature
    value: { type: Number, required: true },   // length or area
    unit: { type: String, required: true }      // "m" or "m²"
  },
  { timestamps: true }
);

const Measurement = mongoose.model("Measurement", MeasurementSchema);

// Root – so you can open http://localhost:3000 in browser and see something
app.get("/", (req, res) => {
  res.type("text/plain").send("API is running. Try /api/health or /api/measurements");
});

// Get all saved measurements
app.get("/api/measurements", async (req, res) => {
  try {
    const items = await Measurement.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    console.error("GET /api/measurements error:", err);
    res.status(503).json({ error: "Database unavailable", details: err.message });
  }
});

// Save new measurement
app.post("/api/measurements", async (req, res) => {
  const { type, geojson, value, unit } = req.body;

  if (!type || !geojson || typeof value !== "number" || !unit) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const saved = await Measurement.create({ type, geojson, value, unit });
  res.status(201).json(saved);
});

// Delete only the most recently added measurement ("last" in DB)
app.delete("/api/measurements/latest", async (req, res) => {
  const latest = await Measurement.findOne().sort({ createdAt: -1 });
  if (!latest) {
    return res.status(404).json({ error: "No measurements to delete" });
  }
  await Measurement.findByIdAndDelete(latest._id);
  res.json({ deletedCount: 1 });
});

// If no route matched, respond so curl doesn't hang
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`✅ API running on http://localhost:${PORT}`);
});