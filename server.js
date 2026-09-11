import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = join(__dirname, 'uploads');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ── Model registry ──
const MODELS = {
  'qwen-27b': {
    id: process.env.MODEL_QWEN_27B || 'choz/Qwen3.8-27B-Uncensored',
    label: 'Qwen3.8 27B Uncensored',
    description: '27B params · General purpose'
  },
  'ornith-9b': {
    id: process.env.MODEL_ORNITH_9B || 'huihui-ai/Huihui-Ornith-1.5-9B-abliterated',
    label: 'Huihui Ornith 1.5 9B',
    description: '9B params · Fast inference'
  },
  'ornith-35b': {
    id: process.env.MODEL_ORNITH_35B || 'huihui-ai/Huihui-Ornith-1.5-35B-A3B-abliterated',
    label: 'Huihui Ornith 1.5 35B-A3B',
    description: 'MoE · 35B total, 3B active'
  }
};

// ── GET /api/models ──
app.get('/api/models', (req, res) => {
  res.json({ models: MODELS });
});

// ── POST /api/chat (streaming) ──
app.post('/api/chat', async (req, res) => {
  const { messages, model } = req.body;

  const modelConfig = MODELS[model];
  if (!modelConfig) {
    return res.status(400).json({ error: `Unknown model: ${model}` });
  }

  const apiBase = process.env.API_BASE_URL || 'http://localhost:8000/v1';
  const apiKey = process.env.API_KEY || '';

  // Set up SSE streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
      },
      body: JSON.stringify({
        model: modelConfig.id,
        messages,
        stream: true,
        max_tokens: 4096,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const err = await response.text();
      res.write(`data: ${JSON.stringify({ error: `API error ${response.status}: ${err}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // Pipe the SSE stream from the model API to the client
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Chat API error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ── POST /api/clone (website cloner) ──
app.post('/api/clone', async (req, res) => {
  const { url, mode, auth } = req.body;
  // mode: 'ditto' (public URL) or 'deep' (authenticated)

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    if (mode === 'deep' || auth) {
      // Deep Clone with authentication via Playwright
      res.write(`data: ${JSON.stringify({ step: 'init', message: 'Launching browser for authenticated clone...' })}\n\n`);

      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: false }); // visible for login
      const context = await browser.newContext();
      const page = await context.newPage();

      // If auth cookies/session provided, set them
      if (auth?.cookies) {
        await context.addCookies(auth.cookies);
      }

      res.write(`data: ${JSON.stringify({ step: 'navigate', message: `Navigating to ${url}...` })}\n\n`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

      // Wait for user login if needed (deep clone opens visible browser)
      if (auth?.waitForLogin) {
        res.write(`data: ${JSON.stringify({ step: 'login', message: 'Browser open — please log in. Waiting for navigation...' })}\n\n`);
        await page.waitForNavigation({ timeout: 120000 }).catch(() => {});
      }

      // Capture page content
      res.write(`data: ${JSON.stringify({ step: 'capture', message: 'Capturing page HTML + assets...' })}\n\n`);
      const html = await page.content();
      const screenshot = await page.screenshot({ fullPage: true, type: 'png' });

      // Extract all stylesheets
      const styles = await page.evaluate(() => {
        const sheets = [];
        for (const sheet of document.styleSheets) {
          try {
            const rules = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
            sheets.push(rules);
          } catch (e) {
            if (sheet.href) sheets.push(`/* External: ${sheet.href} */`);
          }
        }
        return sheets.join('\n\n');
      });

      await browser.close();

      res.write(`data: ${JSON.stringify({
        step: 'complete',
        message: 'Clone captured successfully',
        data: {
          html: html.substring(0, 50000), // Truncate for streaming
          cssLength: styles.length,
          screenshotSize: screenshot.length,
          url
        }
      })}\n\n`);
    } else {
      // Ditto mode — public URL deterministic clone
      res.write(`data: ${JSON.stringify({ step: 'init', message: 'Starting Ditto deterministic clone...' })}\n\n`);
      res.write(`data: ${JSON.stringify({ step: 'info', message: 'Run: npx ditto-site ' + url })}\n\n`);
      res.write(`data: ${JSON.stringify({
        step: 'complete',
        message: 'Use the CLI to generate the full Next.js project',
        data: { command: `npx ditto-site ${url}`, url }
      })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Clone error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ── POST /api/upload (file upload) ──
app.post('/api/upload', (req, res) => {
  try {
    const { filename, data, mimeType } = req.body;
    if (!filename || !data) {
      return res.status(400).json({ error: 'filename and data (base64) required' });
    }

    const buffer = Buffer.from(data, 'base64');
    const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const filePath = join(UPLOAD_DIR, safeName);
    writeFileSync(filePath, buffer);

    const fileUrl = `/uploads/${safeName}`;
    const result = { ok: true, filename: safeName, url: fileUrl, size: buffer.length, mimeType };

    // Auto-OCR for images
    if (mimeType && mimeType.startsWith('image/')) {
      try {
        const ocrText = execSync(`tesseract "${filePath}" stdout 2>/dev/null`).toString().trim();
        if (ocrText) result.ocrText = ocrText;
      } catch { /* tesseract not installed or failed */ }
    }

    res.json(result);
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/ocr (extract text from image) ──
app.post('/api/ocr', (req, res) => {
  try {
    const { filename, data } = req.body;
    let filePath;

    if (data) {
      // Base64 image data
      const buffer = Buffer.from(data, 'base64');
      filePath = join(UPLOAD_DIR, `ocr-${Date.now()}.png`);
      writeFileSync(filePath, buffer);
    } else if (filename) {
      filePath = join(UPLOAD_DIR, filename);
    } else {
      return res.status(400).json({ error: 'filename or data (base64) required' });
    }

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const text = execSync(`tesseract "${filePath}" stdout 2>/dev/null`).toString().trim();
    res.json({ ok: true, text, charCount: text.length });
  } catch (err) {
    console.error('OCR error:', err.message);
    res.status(500).json({ error: 'OCR failed — ensure tesseract is installed: sudo apt install tesseract-ocr' });
  }
});

// ── Fallback to index.html (SPA) ──
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║     🤖 Your AI Platform is running!      ║
  ║     http://localhost:${PORT}               ║
  ║                                          ║
  ║  Models:                                 ║
  ║   • Qwen3.8 27B Uncensored              ║
  ║   • Huihui Ornith 1.5 9B                ║
  ║   • Huihui Ornith 1.5 35B-A3B           ║
  ║                                          ║
  ║  Workspaces:                             ║
  ║   • Chat — /                             ║
  ║   • Code — OpenHands integration         ║
  ║   • Cloner — Ditto + Deep Clone          ║
  ╚══════════════════════════════════════════╝
  `);
});
