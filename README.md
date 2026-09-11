# 🤖 Your AI Platform

**Chat + Code + Cloner** — All-in-one AI platform with uncensored models, OpenHands coding workspace, and authenticated website cloning.

![Node.js](https://img.shields.io/badge/Node.js-20+-green?logo=node.js)
![License](https://img.shields.io/badge/License-MIT-blue)

## Architecture

```
YOUR AI PLATFORM
│
├── 💬 Chat — ChatGPT-style interface
│   ├── Streaming responses (SSE)
│   ├── Model selector (3 models)
│   ├── File upload + OCR (images/video)
│   ├── Conversation history
│   └── Copy / Regenerate actions
│
├── ⌨️ Code — OpenHands integration
│   └── AI-powered coding workspace
│
├── 🔗 Cloner — Website replication
│   ├── Ditto.site (public URLs → Next.js)
│   └── Deep Clone (authenticated → Playwright)
│
└── 🧠 AI Model API (OpenAI-compatible)
    ├── choz/Qwen3.8-27B-Uncensored
    ├── huihui-ai/Huihui-Ornith-1.5-9B-abliterated
    └── huihui-ai/Huihui-Ornith-1.5-35B-A3B-abliterated
```

## Models (HuggingFace)

| Model | HuggingFace ID | Size | Type |
|-------|---------------|------|------|
| Qwen3.8 27B Uncensored | `choz/Qwen3.8-27B-Uncensored` | 27B | Dense |
| Huihui Ornith 1.5 9B | `huihui-ai/Huihui-Ornith-1.5-9B-abliterated` | 9B | Dense |
| Huihui Ornith 1.5 35B-A3B | `huihui-ai/Huihui-Ornith-1.5-35B-A3B-abliterated` | 35B (3B active) | MoE |

## Quick Start (Local)

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/your-ai-platform.git
cd your-ai-platform

# Install
npm install
npx playwright install --with-deps chromium

# Configure
cp .env.example .env
# Edit .env with your API endpoint

# Run
npm start
# → http://localhost:3000
```

## Vultr Server Setup (64GB RAM, Ubuntu)

```bash
# SSH into your Vultr server
ssh root@YOUR_VULTR_IP

# Download and run the setup script
chmod +x setup-server.sh
./setup-server.sh

# This will:
# 1. Install Node.js 20, Python, NVIDIA drivers
# 2. Install vLLM for model serving
# 3. Download all 3 models from HuggingFace
# 4. Setup the web app + Nginx reverse proxy
# 5. Create systemd services for auto-start
```

### After Setup

```bash
# Start model server (loads first model)
sudo systemctl start vllm-server

# Wait 2-5 minutes for model to load, then verify:
curl http://localhost:8000/v1/models

# Start the web app
sudo systemctl start ai-platform

# Access: http://YOUR_VULTR_IP
```

### Switching Models in vLLM

vLLM serves one model at a time. To switch:

```bash
# Edit the service file
sudo nano /etc/systemd/system/vllm-server.service

# Change --model to:
#   choz/Qwen3.8-27B-Uncensored
#   huihui-ai/Huihui-Ornith-1.5-9B-abliterated
#   huihui-ai/Huihui-Ornith-1.5-35B-A3B-abliterated

# Reload and restart
sudo systemctl daemon-reload
sudo systemctl restart vllm-server
```

> **Tip:** For multi-model serving, use [LiteLLM](https://github.com/BerriAI/litellm) as a proxy in front of multiple vLLM instances.

### Recommended Vultr Instance

| Spec | Minimum | Recommended |
|------|---------|-------------|
| RAM | 64GB | 128GB |
| GPU | A40 (48GB VRAM) | A100 (80GB VRAM) |
| CPU | 8 cores | 16 cores |
| Storage | 200GB NVMe | 500GB NVMe |
| OS | Ubuntu 22.04 | Ubuntu 24.04 |

## Features

### 💬 Chat
- ChatGPT-style dark interface
- Real-time streaming via SSE
- Model selector with all 3 HuggingFace models
- **File upload** — images, videos, PDFs
- **OCR** — extract text from uploaded images via Tesseract
- Conversation sidebar with history
- Copy & Regenerate buttons
- Keyboard shortcuts (Enter to send)
- Mobile responsive

### ⌨️ Code (OpenHands)
- Launch OpenHands coding workspace
- Integration point for [All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)

### 🔗 Cloner
- **Ditto.site** — Deterministic public URL → Next.js clone
- **Deep Clone** — Authenticated website cloning via Playwright
- Interactive login flow (opens visible browser)
- Downloads HTML, CSS, images, fonts, media
- Page-by-page crawling with configurable depth
- Clone progress log with real-time updates

### 🔐 Authentication Cloning
The Deep Clone module supports:
1. Navigate to login page
2. Open visible browser for manual login
3. Capture authenticated session cookies
4. Clone all pages behind login
5. Save cookies for reuse

## Open Source Tools Integrated

| Tool | Purpose | Link |
|------|---------|------|
| **Ditto.site** | Deterministic website → Next.js | [ion-design/ditto.site](https://github.com/ion-design/ditto.site) |
| **Deep Site Clone** | Auth login + full crawl | [hi5jeff/deepclonewebsite](https://github.com/hi5jeff/deepclonewebsite) |
| **OpenHands** | AI coding workspace | [All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands) |
| **vLLM** | HuggingFace model serving | [vllm-project/vllm](https://github.com/vllm-project/vllm) |
| **Playwright** | Browser automation for cloning | [microsoft/playwright](https://github.com/nicraboy/playwright) |
| **Tesseract** | OCR for uploaded images | [tesseract-ocr](https://github.com/tesseract-ocr/tesseract) |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/models` | List available models |
| POST | `/api/chat` | Chat completion (SSE streaming) |
| POST | `/api/clone` | Clone a website |
| POST | `/api/upload` | Upload file (image/video/PDF) |
| POST | `/api/ocr` | Extract text from image |

## Project Structure

```
your-ai-platform/
├── public/
│   └── index.html          # Full UI (Chat + Code + Cloner)
├── cloner/
│   └── deep-clone.js       # Authenticated website cloner CLI
├── uploads/                 # Uploaded files (gitignored)
├── server.js               # Express backend + API proxy
├── setup-server.sh         # Vultr/Ubuntu server setup script
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## License

MIT
