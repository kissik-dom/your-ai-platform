/**
 * Your AI Platform — Security-Hardened Server
 * Government-grade security: CSP, CORS, rate limiting, input sanitization,
 * session auth, helmet headers, CSRF protection, zero-day hardening.
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { createServer } = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// 1. SECURITY HEADERS (Helmet — covers OWASP top 10 headers)
// ============================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // needed for inline styles
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true,
}));

// Additional hardening headers
app.use((req, res, next) => {
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.removeHeader('X-Powered-By');
  next();
});

// ============================================================
// 2. CORS — Strict origin lockdown
// ============================================================
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin requests (no origin header) and whitelisted origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS blocked'));
  },
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  maxAge: 86400,
}));

// ============================================================
// 3. BODY PARSING with size limits (prevent payload bombs)
// ============================================================
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ============================================================
// 4. RATE LIMITING — tiered by endpoint sensitivity
// ============================================================

// Global rate limit: 100 requests per 15 min per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  keyGenerator: (req) => req.ip,
});
app.use(globalLimiter);

// Auth endpoints: strict 10 per 15 min
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// Chat API: 30 per minute
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Chat rate limit reached. Slow down.' },
});

// Clone API: 5 per hour (expensive operation)
const cloneLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Clone limit reached. Try again later.' },
});

// Speed limiter: progressively slow down after 50 requests
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 50,
  delayMs: (hits) => hits * 100,
});
app.use(speedLimiter);

// ============================================================
// 5. SESSION AUTH — secure cookie-based sessions
// ============================================================
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex');

app.use(session({
  name: '__Host-sid',  // __Host- prefix enforces Secure + no Domain
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 4 * 60 * 60 * 1000,  // 4 hours
    path: '/',
  },
}));

// CSRF token generation & validation
function generateCSRF(session) {
  if (!session.csrfToken) {
    session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return session.csrfToken;
}

function validateCSRF(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.headers['x-csrf-token'] || req.body?._csrf;
  if (!token || token !== req.session?.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

// ============================================================
// 6. INPUT SANITIZATION — prevent XSS, injection, path traversal
// ============================================================
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/[<>]/g, '')           // strip HTML angle brackets
    .replace(/javascript:/gi, '')    // strip JS protocol
    .replace(/on\w+\s*=/gi, '')     // strip event handlers
    .replace(/\.\.\//g, '')          // strip path traversal
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // strip control chars
}

function sanitizeInput(req, res, next) {
  const sanitizeObj = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        obj[key] = sanitizeString(obj[key]);
      } else if (typeof obj[key] === 'object') {
        sanitizeObj(obj[key]);
      }
    }
    return obj;
  };
  if (req.body) sanitizeObj(req.body);
  if (req.query) sanitizeObj(req.query);
  if (req.params) sanitizeObj(req.params);
  next();
}
app.use(sanitizeInput);

// ============================================================
// 7. AUTH MIDDLEWARE — protect API routes
// ============================================================
const USERS = {}; // In production: use a database

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

// ============================================================
// 8. STATIC FILES with cache control
// ============================================================
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// ============================================================
// 9. UPLOAD DIRECTORY — secured
// ============================================================
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ============================================================
// 10. MODEL REGISTRY
// ============================================================
const MODELS = {
  'qwen-27b': {
    id: 'qwen-27b',
    name: 'Qwen 2.5 27B',
    provider: 'huggingface',
    endpoint: process.env.VLLM_URL || 'http://localhost:8000/v1',
    hfId: 'Qwen/Qwen2.5-Coder-32B-Instruct',
  },
  'ornith-9b': {
    id: 'ornith-9b',
    name: 'Ornith 9B',
    provider: 'huggingface',
    endpoint: process.env.VLLM_URL || 'http://localhost:8000/v1',
    hfId: 'OrionStarAI/Orion-9B-Chat',
  },
  'ornith-35b': {
    id: 'ornith-35b',
    name: 'Ornith 35B',
    provider: 'huggingface',
    endpoint: process.env.VLLM_URL || 'http://localhost:8000/v1',
    hfId: 'OrionStarAI/Orion-35B-Chat',
  },
};

// ============================================================
// ROUTES
// ============================================================

// --- Auth routes ---
app.post('/api/auth/register', authLimiter, validateCSRF, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (username.length < 3 || username.length > 30 || !/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Username: 3-30 chars, alphanumeric + underscore only' });
  }
  if (password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters' });
  }
  if (USERS[username]) {
    return res.status(409).json({ error: 'Username taken' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  USERS[username] = { salt, hash, createdAt: new Date().toISOString() };

  req.session.userId = username;
  req.session.loginAt = Date.now();
  res.json({ ok: true, user: username, csrf: generateCSRF(req.session) });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = USERS[username];
  if (!user) {
    // Constant-time fake check to prevent user enumeration
    crypto.scryptSync(password, crypto.randomBytes(16), 64);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const hash = crypto.scryptSync(password, user.salt, 64).toString('hex');
  if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(user.hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.userId = username;
    req.session.loginAt = Date.now();
    res.json({ ok: true, user: username, csrf: generateCSRF(req.session) });
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('__Host-sid');
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session?.userId) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: req.session.userId, csrf: generateCSRF(req.session) });
});

// --- Models ---
app.get('/api/models', requireAuth, (req, res) => {
  res.json(Object.values(MODELS).map(m => ({ id: m.id, name: m.name })));
});

// --- Chat (streaming SSE) ---
app.post('/api/chat', requireAuth, chatLimiter, validateCSRF, async (req, res) => {
  const { model, messages } = req.body;

  if (!model || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'model and messages[] required' });
  }
  if (messages.length > 50) {
    return res.status(400).json({ error: 'Max 50 messages per request' });
  }
  // Validate each message
  for (const msg of messages) {
    if (!msg.role || !msg.content) {
      return res.status(400).json({ error: 'Each message needs role and content' });
    }
    if (!['user', 'assistant', 'system'].includes(msg.role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (msg.content.length > 10000) {
      return res.status(400).json({ error: 'Message too long (max 10000 chars)' });
    }
  }

  const modelConfig = MODELS[model];
  if (!modelConfig) {
    return res.status(400).json({ error: 'Unknown model' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`${modelConfig.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelConfig.hfId, messages, stream: true, max_tokens: 2048 }),
      timeout: 60000,
    });

    if (!response.ok) {
      res.write(`data: ${JSON.stringify({ error: 'Model unavailable' })}\n\n`);
      return res.end();
    }

    response.body.on('data', (chunk) => {
      res.write(chunk);
    });
    response.body.on('end', () => res.end());
    response.body.on('error', () => res.end());

    req.on('close', () => {
      response.body?.destroy();
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: 'Service temporarily unavailable' })}\n\n`);
    res.end();
  }
});

// --- Clone (authenticated deep clone) ---
app.post('/api/clone', requireAuth, cloneLimiter, validateCSRF, async (req, res) => {
  const { url, pages = 5, auth: needsAuth = false } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL required' });
  }
  // URL validation — only allow http(s)
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Only HTTP/HTTPS URLs allowed' });
    }
    // Block internal/private IPs (SSRF protection)
    const host = parsed.hostname;
    if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|localhost|::1|fc|fd)/i.test(host)) {
      return res.status(400).json({ error: 'Internal URLs not allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (pages < 1 || pages > 20) {
    return res.status(400).json({ error: 'Pages must be 1-20' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    const { cloneSite } = require('./cloner/deep-clone');
    await cloneSite({ url, pages, needsAuth, onProgress: (msg) => {
      res.write(`data: ${JSON.stringify({ progress: sanitizeString(msg) })}\n\n`);
    }});
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: 'Clone failed' })}\n\n`);
  }
  res.end();
});

// --- File upload (secured) ---
app.post('/api/upload', requireAuth, validateCSRF, (req, res) => {
  const { filename, data, mimeType } = req.body;
  if (!filename || !data) {
    return res.status(400).json({ error: 'filename and data required' });
  }

  // Validate filename — no path traversal
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (safeName !== filename || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  // Validate mime type
  const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'application/pdf', 'text/plain'];
  if (mimeType && !ALLOWED_MIMES.includes(mimeType)) {
    return res.status(400).json({ error: 'File type not allowed' });
  }

  // Size check (10MB max)
  const buf = Buffer.from(data, 'base64');
  if (buf.length > 10 * 1024 * 1024) {
    return res.status(400).json({ error: 'File too large (max 10MB)' });
  }

  const uniqueName = `${Date.now()}-${safeName}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, uniqueName), buf);

  res.json({ ok: true, url: `/uploads/${uniqueName}` });
});

// Serve uploads with auth check
app.use('/uploads', requireAuth, express.static(UPLOAD_DIR, { maxAge: '1h' }));

// --- OCR ---
app.post('/api/ocr', requireAuth, validateCSRF, async (req, res) => {
  const { filename, data } = req.body;
  if (!filename && !data) {
    return res.status(400).json({ error: 'filename or data required' });
  }

  try {
    const Tesseract = require('tesseract.js');
    let imagePath;

    if (data) {
      const buf = Buffer.from(data, 'base64');
      if (buf.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'File too large' });
      }
      imagePath = path.join(UPLOAD_DIR, `ocr-${Date.now()}.png`);
      fs.writeFileSync(imagePath, buf);
    } else {
      const safeName = path.basename(filename);
      imagePath = path.join(UPLOAD_DIR, safeName);
      if (!fs.existsSync(imagePath)) {
        return res.status(404).json({ error: 'File not found' });
      }
    }

    const { data: result } = await Tesseract.recognize(imagePath, 'eng');
    // Clean up temp file
    if (data && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

    res.json({ text: result.text, chars: result.text.length });
  } catch {
    res.status(500).json({ error: 'OCR failed' });
  }
});

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// --- CSRF token endpoint ---
app.get('/api/csrf', (req, res) => {
  res.json({ csrf: generateCSRF(req.session) });
});

// --- SPA fallback ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// ERROR HANDLING — never leak stack traces
// ============================================================
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  if (err.message === 'CORS blocked') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║        YOUR AI PLATFORM — SECURE SERVER           ║
╠═══════════════════════════════════════════════════╣
║  🔒 Helmet security headers     ✅ Active         ║
║  🛡️  CORS lockdown               ✅ Active         ║
║  ⏱️  Rate limiting               ✅ Active         ║
║  🔑 Session auth                 ✅ Active         ║
║  🛑 CSRF protection              ✅ Active         ║
║  🧹 Input sanitization           ✅ Active         ║
║  📝 SSRF protection              ✅ Active         ║
╠═══════════════════════════════════════════════════╣
║  Models: qwen-27b | ornith-9b | ornith-35b       ║
║  Workspaces: Chat | Code | Cloner                ║
║  Port: ${String(PORT).padEnd(42)}║
╚═══════════════════════════════════════════════════╝
  `);
});

module.exports = app;
