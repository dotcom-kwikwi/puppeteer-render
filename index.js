const express = require("express");
const { 
  startSudokuSolver,
  submitPhone,
  submitOTP,
  getStatus
} = require("./scrapeLogic");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "Sudoku Solver API is running",
    endpoints: {
      start: "/start - POST - Start solving process",
      phone: "/phone - POST - Submit phone number (body: {phone: 'xxx'})",
      otp: "/otp - POST - Submit OTP code (body: {otp: 'xxx'})",
      status: "/status - GET - Get current status"
    }
  });
});

app.post("/start", async (req, res) => {
  try {
    const result = await startSudokuSolver();
    res.json({ success: true, message: "Sudoku solving process started", data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/phone", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) throw new Error("Phone number is required");
    await submitPhone(phone);
    res.json({ success: true, message: "Phone number received" });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post("/otp", async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) throw new Error("OTP code is required");
    await submitOTP(otp);
    res.json({ success: true, message: "OTP code received" });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get("/status", async (req, res) => {
  try {
    const status = await getStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Sudoku Solver API running on port ${PORT}`);
});
