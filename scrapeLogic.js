const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Constants
const COOKIE_FILE = path.join(__dirname, 'cookies.json');
const MAX_SOLVED_PER_SESSION = 300;
const GAME_URL = "https://sudoku.lumitelburundi.com/game";
const BASE_URL = "https://sudoku.lumitelburundi.com";

// State
let currentBrowser = null;
let currentPage = null;
let waitingForPhone = false;
let waitingForOTP = false;
let phoneNumber = '';
let otpCode = '';
let isProcessing = false;
let solvedCount = 0;

// Utility Functions
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const saveCookies = async (page) => {
  try {
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
    console.log('Cookies saved successfully');
  } catch (error) {
    console.error('Error saving cookies:', error.message);
  }
};

const loadCookies = async (page) => {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
      await page.setCookie(...cookies);
      console.log('Cookies loaded successfully');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error loading cookies:', error.message);
    return false;
  }
};

// Sudoku Solver Algorithm
const isSafe = (board, row, col, num) => {
  // Check row
  for (let d = 0; d < board.length; d++) {
    if (board[row][d] === num) return false;
  }
  
  // Check column
  for (let r = 0; r < board.length; r++) {
    if (board[r][col] === num) return false;
  }
  
  // Check 3x3 box
  const sqrt = Math.sqrt(board.length);
  const boxRowStart = row - row % sqrt;
  const boxColStart = col - col % sqrt;
  
  for (let r = boxRowStart; r < boxRowStart + sqrt; r++) {
    for (let c = boxColStart; c < boxColStart + sqrt; c++) {
      if (board[r][c] === num) return false;
    }
  }
  
  return true;
};

const solveSudokuBoard = (board) => {
  const size = board.length;
  let row = -1;
  let col = -1;
  let isEmpty = true;
  
  // Find first empty cell
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (board[i][j] === 0) {
        row = i;
        col = j;
        isEmpty = false;
        break;
      }
    }
    if (!isEmpty) break;
  }
  
  // No empty cells left
  if (isEmpty) return true;
  
  // Try numbers 1-9
  for (let num = 1; num <= size; num++) {
    if (isSafe(board, row, col, num)) {
      board[row][col] = num;
      if (solveSudokuBoard(board)) return true;
      board[row][col] = 0; // Backtrack
    }
  }
  
  return false;
};

// Puppeteer Functions
const initBrowser = async () => {
  return await puppeteer.launch({
    args: [
      "--disable-setuid-sandbox",
      "--no-sandbox",
      "--single-process",
      "--no-zygote",
      "--disable-dev-shm-usage"
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: "new",
    timeout: 60000
  });
};

const getSudokuGrid = async (page) => {
  try {
    await page.waitForSelector("div.grid.grid-cols-9.gap-0.border-4.border-black", { 
      timeout: 20000,
      visible: true
    });
    
    return await page.evaluate(() => {
      const cells = document.querySelectorAll("div.grid.grid-cols-9.gap-0.border-4.border-black div.w-10.h-10");
      return Array.from(cells).map(cell => {
        const text = cell.textContent.trim();
        return text === '' ? 0 : parseInt(text);
      });
    });
  } catch (error) {
    console.error('Error getting grid:', error.message);
    return null;
  }
};

const fillSolution = async (page, solvedValues) => {
  try {
    const cells = await page.$$("div.grid.grid-cols-9.gap-0.border-4.border-black div.w-10.h-10");
    const numberButtons = await page.$$("div.flex.gap-2.mt-4 button");
    
    for (let i = 0; i < Math.min(cells.length, 81); i++) {
      const currentValue = await cells[i].evaluate(el => el.textContent.trim());
      const targetValue = solvedValues[i].toString();
      
      if (currentValue === targetValue) continue;
      
      if (!currentValue && targetValue) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await cells[i].click();
            await sleep(300);
            
            const isSelected = await cells[i].evaluate(el => 
              el.className.includes("bg-blue-200")
            );
            
            if (isSelected && numberButtons[parseInt(targetValue) - 1]) {
              await numberButtons[parseInt(targetValue) - 1].click();
              await sleep(500);
              
              const newValue = await cells[i].evaluate(el => el.textContent.trim());
              if (newValue === targetValue) break;
              
              console.log(`Retrying cell ${i} (value not accepted)`);
              await sleep(1000);
            }
          } catch (error) {
            console.log(`Error on cell ${i}: ${error.message.substring(0, 50)}`);
            await sleep(1000);
          }
        }
      }
    }
    return true;
  } catch (error) {
    console.error('Error filling solution:', error.message);
    return false;
  }
};

const handleLogin = async (page, cookiesLoaded = false) => {
  try {
    await page.goto(GAME_URL, { waitUntil: "networkidle2" });
    await sleep(2000);
    
    const currentUrl = page.url();
    if (!currentUrl.includes(GAME_URL)) {
      if (cookiesLoaded) {
        console.log("Cookies may be expired, starting fresh login");
      }
      
      console.log("Starting login process...");
      
      // Click login button
      await page.waitForSelector("button.w-53.py-3.px-6.bg-gradient-to-r.from-amber-400.to-amber-500.text-white.text-lg.font-bold.rounded-full.shadow-lg.mt-36", 
        { timeout: 30000 });
      await page.click("button.w-53.py-3.px-6.bg-gradient-to-r.from-amber-400.to-amber-500.text-white.text-lg.font-bold.rounded-full.shadow-lg.mt-36");
      await sleep(2000);
      
      // Wait for phone input
      await page.waitForSelector("input[placeholder='Nimushiremwo inomero ya terefone']", { timeout: 30000 });
      
      // Set phone number from state
      if (!phoneNumber) {
        waitingForPhone = true;
        console.log("Waiting for phone number...");
        while (waitingForPhone) await sleep(1000);
      }
      
      await page.type("input[placeholder='Nimushiremwo inomero ya terefone']", phoneNumber);
      await sleep(1000);
      
      // Click send OTP button
      await page.click("button.w-full.py-2.bg-red-700.text-white.rounded-md.font-semibold.hover\\:bg-red-600.transition.duration-200");
      await sleep(2000);
      
      // Wait for OTP input
      await page.waitForSelector("input[placeholder='OTP']", { timeout: 30000 });
      
      // Set OTP from state
      if (!otpCode) {
        waitingForOTP = true;
        console.log("Waiting for OTP...");
        while (waitingForOTP) await sleep(1000);
      }
      
      await page.type("input[placeholder='OTP']", otpCode);
      await sleep(1000);
      
      // Click verify button
      await page.click("button.w-full.py-2.bg-red-700.text-white.rounded-md.font-semibold.hover\\:bg-red-800.transition.duration-200");
      await sleep(10000);
      
      // Verify login success
      await page.goto(GAME_URL, { waitUntil: "networkidle2" });
      await sleep(3000);
    }
    
    console.log("Login successful");
    return true;
  } catch (error) {
    console.error('Login error:', error.message);
    return false;
  }
};

const solveOneSudoku = async (page, roundNumber) => {
  console.log(`\n=== ROUND ${roundNumber} ===`);
  
  try {
    // Get current grid
    let gridValues = await getSudokuGrid(page);
    if (!gridValues) {
      await page.reload({ waitUntil: "networkidle2" });
      await sleep(3000);
      gridValues = await getSudokuGrid(page);
      if (!gridValues) return false;
    }
    
    // Convert to 2D array
    const board = [];
    while (gridValues.length) board.push(gridValues.splice(0, 9));
    
    // Solve the board
    const startTime = Date.now();
    const isSolved = solveSudokuBoard(board);
    console.log(`Solved in ${(Date.now() - startTime)/1000} seconds`);
    
    if (!isSolved) {
      console.log("No solution found for this grid");
      return false;
    }
    
    // Convert back to 1D array
    const solvedValues = board.flat();
    
    // Fill the solution
    await fillSolution(page, solvedValues);
    
    // Load new puzzle
    try {
      await page.click("button.py-2.px-4.bg-red-800.text-white.rounded-full.ml-5");
      await sleep(4000);
      return true;
    } catch (error) {
      console.log("Failed to load new puzzle, refreshing...");
      await page.reload({ waitUntil: "networkidle2" });
      await sleep(3000);
      return false;
    }
  } catch (error) {
    console.error('Error solving puzzle:', error.message);
    return false;
  }
};

// Main Functions
const startSudokuSolver = async () => {
  if (isProcessing) throw new Error("Solver is already running");
  
  isProcessing = true;
  solvedCount = 0;
  
  try {
    currentBrowser = await initBrowser();
    currentPage = await currentBrowser.newPage();
    await currentPage.setViewport({ width: 1280, height: 720 });
    
    // Load cookies and login
    const cookiesLoaded = await loadCookies(currentPage);
    const loginSuccess = await handleLogin(currentPage, cookiesLoaded);
    
    if (!loginSuccess) {
      throw new Error("Failed to login");
    }
    
    await saveCookies(currentPage);
    
    // Start solving loop
    let roundNumber = 1;
    const maxRetries = 3;
    
    while (solvedCount < MAX_SOLVED_PER_SESSION) {
      let retries = 0;
      let success = false;
      
      while (!success && retries < maxRetries) {
        success = await solveOneSudoku(currentPage, roundNumber);
        if (!success) {
          retries++;
          console.log(`Retry ${retries}/${maxRetries}`);
          await sleep(2000);
        }
      }
      
      if (success) {
        solvedCount++;
        roundNumber++;
        console.log(`Solved count: ${solvedCount}/${MAX_SOLVED_PER_SESSION}`);
      } else {
        console.log("Resetting browser after failed attempts");
        await resetBrowser();
      }
    }
    
    return { success: true, solved: solvedCount };
  } finally {
    if (currentBrowser) await currentBrowser.close();
    isProcessing = false;
  }
};

const resetBrowser = async () => {
  try {
    if (currentPage) await saveCookies(currentPage);
    if (currentBrowser) await currentBrowser.close();
    
    currentBrowser = await initBrowser();
    currentPage = await currentBrowser.newPage();
    await loadCookies(currentPage);
    
    return true;
  } catch (error) {
    console.error('Error resetting browser:', error.message);
    return false;
  }
};

// Exported Functions
module.exports = {
  startSudokuSolver,
  submitPhone: (phone) => { 
    if (!phone) throw new Error("Phone number is required");
    phoneNumber = phone; 
    waitingForPhone = false; 
  },
  submitOTP: (otp) => { 
    if (!otp) throw new Error("OTP code is required");
    otpCode = otp; 
    waitingForOTP = false; 
  },
  getStatus: () => ({
    isProcessing,
    waitingForPhone,
    waitingForOTP,
    hasBrowser: !!currentBrowser,
    hasPage: !!currentPage,
    solvedCount,
    maxPerSession: MAX_SOLVED_PER_SESSION
  })
};
