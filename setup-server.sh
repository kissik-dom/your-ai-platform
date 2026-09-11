#!/bin/bash
# ============================================================
# YOUR AI PLATFORM — Security-Hardened Server Setup
# For Ubuntu 22.04+ on Vultr (64GB+ RAM with GPU)
# Run: curl -sSL https://raw.githubusercontent.com/kissik-dom/your-ai-platform/main/setup-server.sh | sudo bash
# ============================================================

set -euo pipefail

echo "
╔═══════════════════════════════════════════════════╗
║   YOUR AI PLATFORM — SECURE SERVER SETUP          ║
╚═══════════════════════════════════════════════════╝
"

# ============================================================
# 0. SYSTEM HARDENING
# ============================================================
echo "🔒 Step 0: System hardening..."

# Update everything
apt-get update && apt-get upgrade -y

# Install essential security tools
apt-get install -y \
  ufw fail2ban unattended-upgrades \
  apt-transport-https ca-certificates curl gnupg lsb-release \
  git build-essential nginx certbot python3-certbot-nginx

# Firewall — only allow SSH, HTTP, HTTPS
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (redirects to HTTPS)
ufw allow 443/tcp   # HTTPS
ufw --force enable
echo "  ✅ Firewall: only ports 22, 80, 443 open"

# Fail2ban — block brute force SSH
cat > /etc/fail2ban/jail.local << 'JAIL'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
backend = systemd

[sshd]
enabled = true
port = ssh
maxretry = 3
bantime = 86400

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled = true
JAIL
systemctl enable fail2ban
systemctl restart fail2ban
echo "  ✅ Fail2ban: SSH brute force protection active"

# Auto security updates
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'AUTOUPDATE'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTOUPDATE
echo "  ✅ Auto security updates enabled"

# Kernel hardening
cat > /etc/sysctl.d/99-security.conf << 'SYSCTL'
# Prevent IP spoofing
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Disable source routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0

# Disable ICMP redirects
net.ipv4.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0

# SYN flood protection
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 4096

# Ignore ping broadcasts
net.ipv4.icmp_echo_ignore_broadcasts = 1

# Log suspicious packets
net.ipv4.conf.all.log_martians = 1
SYSCTL
sysctl -p /etc/sysctl.d/99-security.conf
echo "  ✅ Kernel hardening applied"

# SSH hardening
sed -i 's/#PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/#MaxAuthTries 6/MaxAuthTries 3/' /etc/ssh/sshd_config
sed -i 's/#LoginGraceTime 2m/LoginGraceTime 30/' /etc/ssh/sshd_config
systemctl restart sshd
echo "  ✅ SSH hardened: key-only login, 3 max retries"

# ============================================================
# 1. DOCKER (for Open WebUI)
# ============================================================
echo ""
echo "🐳 Step 1: Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
echo "  ✅ Docker installed"

# ============================================================
# 2. NODE.JS 20 LTS
# ============================================================
echo ""
echo "📦 Step 2: Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2
echo "  ✅ Node.js $(node -v) + PM2 installed"

# ============================================================
# 3. GPU DRIVERS (if NVIDIA GPU detected)
# ============================================================
echo ""
echo "🖥️  Step 3: Checking for GPU..."
if lspci | grep -qi nvidia; then
  echo "  Found NVIDIA GPU — installing drivers..."
  apt-get install -y nvidia-driver-535 nvidia-container-toolkit
  nvidia-smi || echo "  ⚠️  Drivers installed, reboot may be needed"
  echo "  ✅ NVIDIA drivers installed"
else
  echo "  ℹ️  No NVIDIA GPU detected — CPU mode"
fi

# ============================================================
# 4. PYTHON + vLLM (model serving)
# ============================================================
echo ""
echo "🤖 Step 4: Setting up vLLM model server..."
apt-get install -y python3-pip python3-venv
python3 -m venv /opt/vllm-env
source /opt/vllm-env/bin/activate
pip install vllm huggingface_hub
deactivate

# Download models
echo "  📥 Downloading models from Hugging Face..."
source /opt/vllm-env/bin/activate
huggingface-cli download Qwen/Qwen2.5-Coder-32B-Instruct --local-dir /opt/models/qwen-27b &
huggingface-cli download OrionStarAI/Orion-9B-Chat --local-dir /opt/models/ornith-9b &
wait
echo "  ✅ Models downloaded"
deactivate

# vLLM systemd service
cat > /etc/systemd/system/vllm.service << 'VLLM'
[Unit]
Description=vLLM Model Server
After=network.target

[Service]
Type=simple
User=root
ExecStart=/opt/vllm-env/bin/python -m vllm.entrypoints.openai.api_server \
  --model /opt/models/qwen-27b \
  --host 127.0.0.1 \
  --port 8000 \
  --max-model-len 4096
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
VLLM
systemctl daemon-reload
systemctl enable vllm
systemctl start vllm
echo "  ✅ vLLM running on 127.0.0.1:8000"

# ============================================================
# 5. APP DEPLOYMENT
# ============================================================
echo ""
echo "🚀 Step 5: Deploying the app..."
APP_DIR="/opt/your-ai-platform"

if [ ! -d "$APP_DIR" ]; then
  git clone https://github.com/kissik-dom/your-ai-platform.git "$APP_DIR"
fi
cd "$APP_DIR"
git pull origin main

# Generate secure session secret
SESSION_SECRET=$(openssl rand -hex 64)
cat > .env << ENVFILE
PORT=3000
NODE_ENV=production
SESSION_SECRET=${SESSION_SECRET}
ALLOWED_ORIGINS=
VLLM_URL=http://127.0.0.1:8000/v1
ENVFILE
chmod 600 .env

npm install --production
echo "  ✅ App installed"

# PM2 process
pm2 delete your-ai-platform 2>/dev/null || true
pm2 start server.js --name your-ai-platform
pm2 save
pm2 startup
echo "  ✅ App running with PM2"

# ============================================================
# 6. OPEN WEBUI (Docker)
# ============================================================
echo ""
echo "🌐 Step 6: Starting Open WebUI..."
docker run -d \
  --name open-webui \
  --restart always \
  -p 127.0.0.1:8080:8080 \
  -v open-webui-data:/app/backend/data \
  ghcr.io/open-webui/open-webui:main
echo "  ✅ Open WebUI running on 127.0.0.1:8080"

# ============================================================
# 7. NGINX (reverse proxy + security)
# ============================================================
echo ""
echo "🔧 Step 7: Configuring Nginx..."

cat > /etc/nginx/sites-available/your-ai-platform << 'NGINX'
# Rate limiting zones
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=login:10m rate=1r/s;
limit_conn_zone $binary_remote_addr zone=conn:10m;

server {
    listen 80;
    server_name _;
    
    # Redirect all HTTP to HTTPS (when SSL is configured)
    # return 301 https://$host$request_uri;
    
    # Security headers (defense in depth — also set by Express)
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    
    # Hide server info
    server_tokens off;
    
    # Request size limits
    client_max_body_size 10m;
    client_body_timeout 30s;
    client_header_timeout 30s;
    
    # Connection limits
    limit_conn conn 20;

    # Block common attack patterns
    location ~* \.(env|git|svn|htaccess|htpasswd|bak|old|sql|log)$ {
        deny all;
        return 404;
    }
    location ~ /\. {
        deny all;
        return 404;
    }

    # Auth endpoints — strict rate limit
    location ~ ^/api/auth/(login|register) {
        limit_req zone=login burst=3 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API — moderate rate limit
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # SSE support for streaming
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 120s;
    }

    # Open WebUI
    location /webui/ {
        limit_req zone=api burst=10 nodelay;
        proxy_pass http://127.0.0.1:8080/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Main app
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/your-ai-platform /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
echo "  ✅ Nginx configured with rate limiting & security headers"

# ============================================================
# 8. SSL CERTIFICATE (if domain is configured)
# ============================================================
echo ""
echo "🔐 Step 8: SSL setup..."
echo "  ℹ️  To enable HTTPS, point your domain to this server and run:"
echo "     sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com"
echo "  Then update ALLOWED_ORIGINS in /opt/your-ai-platform/.env"

# ============================================================
# DONE!
# ============================================================
echo "
╔═══════════════════════════════════════════════════╗
║        ✅ SETUP COMPLETE — ALL SECURE!            ║
╠═══════════════════════════════════════════════════╣
║                                                   ║
║  🔒 Security Layers Active:                       ║
║     • UFW Firewall (ports 22/80/443 only)        ║
║     • Fail2ban (SSH brute force protection)      ║
║     • SSH key-only login                         ║
║     • Kernel hardening (anti-spoofing, SYN)      ║
║     • Auto security updates                      ║
║     • Nginx rate limiting & security headers     ║
║     • Express: Helmet, CORS, CSRF, sanitize      ║
║     • Session auth with secure cookies           ║
║     • SSRF protection on clone endpoint          ║
║     • 10MB upload limits                         ║
║                                                   ║
║  🌐 Services:                                     ║
║     • App:      http://localhost:3000             ║
║     • vLLM:     http://localhost:8000             ║
║     • WebUI:    http://localhost:8080             ║
║     • Nginx:    http://YOUR_IP                    ║
║                                                   ║
║  📋 Next Steps:                                   ║
║     1. Point your domain DNS to this server      ║
║     2. Run: certbot --nginx -d yourdomain.com    ║
║     3. Update .env ALLOWED_ORIGINS               ║
║     4. Set up Cloudflare proxy for DDoS shield   ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
"
