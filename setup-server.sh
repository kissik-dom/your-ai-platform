#!/bin/bash
# ══════════════════════════════════════════════════════════════
# Your AI Platform — Vultr Server Setup Script
# Ubuntu 22.04/24.04 · 64GB RAM · GPU recommended
# ══════════════════════════════════════════════════════════════

set -e

echo "╔══════════════════════════════════════════════╗"
echo "║   🤖 Your AI Platform — Server Setup         ║"
echo "║   Ubuntu · 64GB RAM · GPU                    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. System updates ──
echo "📦 [1/9] Updating system packages..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y \
  build-essential \
  git \
  curl \
  wget \
  unzip \
  htop \
  tmux \
  nginx \
  certbot \
  python3-certbot-nginx \
  python3-pip \
  python3-venv \
  ffmpeg \
  tesseract-ocr \
  libtesseract-dev

# ── 2. Install Docker (for Open WebUI) ──
echo "🐳 [2/9] Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  sudo systemctl enable docker
  sudo systemctl start docker
  echo "  ✅ Docker installed"
else
  echo "  Docker already installed"
fi

# ── 3. Install Node.js 20 ──
echo "📦 [3/9] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version

# ── 4. Install NVIDIA drivers + CUDA (if GPU) ──
echo "🎮 [4/9] Checking for GPU..."
if lspci | grep -i nvidia > /dev/null 2>&1; then
  echo "  NVIDIA GPU detected — installing drivers + CUDA..."
  sudo apt install -y nvidia-driver-535 nvidia-cuda-toolkit
  # Verify
  nvidia-smi || echo "  ⚠️ nvidia-smi failed — reboot may be needed"
else
  echo "  No NVIDIA GPU detected — models will run on CPU (slower)"
  echo "  For production, consider a Vultr GPU instance (A100/A40)"
fi

# ── 5. Install Python + vLLM (model serving) ──
echo "🐍 [5/9] Setting up Python environment + vLLM..."
python3 -m venv /opt/ai-platform/venv
source /opt/ai-platform/venv/bin/activate

pip install --upgrade pip
pip install \
  vllm \
  huggingface_hub \
  transformers \
  torch \
  accelerate \
  bitsandbytes \
  pytesseract \
  Pillow \
  fastapi \
  uvicorn

# ── 6. Download models from HuggingFace ──
echo "🤗 [6/9] Downloading models from HuggingFace..."
echo "  This will take a while depending on your bandwidth..."

# Create model cache directory
sudo mkdir -p /opt/ai-platform/models
sudo chown -R $USER:$USER /opt/ai-platform

# Download models using huggingface_hub
python3 -c "
from huggingface_hub import snapshot_download
import os

models = [
    'choz/Qwen3.8-27B-Uncensored',
    'huihui-ai/Huihui-Ornith-1.5-9B-abliterated',
    'huihui-ai/Huihui-Ornith-1.5-35B-A3B-abliterated'
]

cache_dir = '/opt/ai-platform/models'

for model in models:
    print(f'  Downloading {model}...')
    try:
        snapshot_download(
            repo_id=model,
            cache_dir=cache_dir,
            resume_download=True
        )
        print(f'  ✅ {model} downloaded')
    except Exception as e:
        print(f'  ⚠️ {model} failed: {e}')
        print(f'  You can retry later: huggingface-cli download {model}')
"

# ── 7. Setup the Node.js app ──
echo "🌐 [7/9] Setting up Your AI Platform..."
cd /opt/ai-platform

# Clone or copy the project
if [ -d "/opt/ai-platform/app" ]; then
  echo "  App directory exists, pulling latest..."
  cd /opt/ai-platform/app && git pull 2>/dev/null || true
else
  echo "  Creating app directory..."
  mkdir -p /opt/ai-platform/app
fi

# Copy project files (if running locally, replace with git clone)
# git clone https://github.com/YOUR_USERNAME/your-ai-platform.git /opt/ai-platform/app

cd /opt/ai-platform/app
npm install

# Install Playwright browsers for the cloner
npx playwright install --with-deps chromium

# Create .env
cat > .env << 'ENVFILE'
# vLLM serves on port 8000 by default
API_BASE_URL=http://localhost:8000/v1
API_KEY=your-secret-key

# Model IDs (must match what vLLM loaded)
MODEL_QWEN_27B=choz/Qwen3.8-27B-Uncensored
MODEL_ORNITH_9B=huihui-ai/Huihui-Ornith-1.5-9B-abliterated
MODEL_ORNITH_35B=huihui-ai/Huihui-Ornith-1.5-35B-A3B-abliterated

PORT=3000
ENVFILE

echo "  ✅ .env created"

# ── 8. Create systemd services ──
echo "⚙️ [8/9] Creating systemd services..."

# vLLM model server service
sudo tee /etc/systemd/system/vllm-server.service > /dev/null << 'SERVICE'
[Unit]
Description=vLLM Model Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/ai-platform
Environment="PATH=/opt/ai-platform/venv/bin:/usr/local/bin:/usr/bin"
ExecStart=/opt/ai-platform/venv/bin/python -m vllm.entrypoints.openai.api_server \
  --model choz/Qwen3.8-27B-Uncensored \
  --download-dir /opt/ai-platform/models \
  --host 0.0.0.0 \
  --port 8000 \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.85 \
  --quantization awq \
  --api-key your-secret-key
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE

# Node.js app service
sudo tee /etc/systemd/system/ai-platform.service > /dev/null << 'SERVICE'
[Unit]
Description=Your AI Platform Web App
After=network.target vllm-server.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/ai-platform/app
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable vllm-server ai-platform

# ── 9. Setup Nginx + Open WebUI ──
echo "🌍 [9/9] Configuring Nginx + Open WebUI..."

# Launch Open WebUI (Docker)
echo "  Starting Open WebUI..."
docker run -d \
  --name open-webui \
  --restart always \
  -p 8080:8080 \
  -e OPENAI_API_BASE_URL=http://host.docker.internal:8000/v1 \
  -e OPENAI_API_KEY=your-secret-key \
  -e WEBUI_AUTH=false \
  -v open-webui-data:/app/backend/data \
  --add-host=host.docker.internal:host-gateway \
  ghcr.io/open-webui/open-webui:main

echo "  ✅ Open WebUI running on port 8080"

sudo tee /etc/nginx/sites-available/ai-platform > /dev/null << 'NGINX'
server {
    listen 80;
    server_name _;

    client_max_body_size 100M;

    # Main platform UI
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # SSE streaming support for chat + clone APIs
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
    }

    # Open WebUI — full-featured chat interface
    location /webui/ {
        proxy_pass http://localhost:8080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/ai-platform /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   ✅ Setup Complete!                         ║"
echo "╠══════════════════════════════════════════════╣"
echo "║                                              ║"
echo "║  Next steps:                                 ║"
echo "║                                              ║"
echo "║  1. Reboot (if GPU drivers were installed):  ║"
echo "║     sudo reboot                              ║"
echo "║                                              ║"
echo "║  2. Start the model server:                  ║"
echo "║     sudo systemctl start vllm-server         ║"
echo "║     (Wait ~2-5 min for model to load)        ║"
echo "║                                              ║"
echo "║  3. Check model server status:               ║"
echo "║     curl http://localhost:8000/v1/models      ║"
echo "║                                              ║"
echo "║  4. Start the web app:                       ║"
echo "║     sudo systemctl start ai-platform         ║"
echo "║                                              ║"
echo "║  5. Access your platform:                    ║"
echo "║     http://YOUR_VULTR_IP       (custom UI)   ║"
echo "║     http://YOUR_VULTR_IP/webui (Open WebUI)  ║"
echo "║                                              ║"
echo "║  Open WebUI is already running (Docker).     ║"
echo "║  It auto-connects to vLLM on port 8000.     ║"
echo "║                                              ║"
echo "║  To switch models in vLLM, edit:             ║"
echo "║     /etc/systemd/system/vllm-server.service  ║"
echo "║     Change --model to the desired model      ║"
echo "║     sudo systemctl daemon-reload             ║"
echo "║     sudo systemctl restart vllm-server       ║"
echo "║                                              ║"
echo "║  For HTTPS (recommended):                    ║"
echo "║     sudo certbot --nginx -d yourdomain.com   ║"
echo "║                                              ║"
echo "╚══════════════════════════════════════════════╝"
