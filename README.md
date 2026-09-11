# Your AI Platform — Security Hardened v2.0

Government-grade secure AI chat interface with integrated code workspace and website cloner.

## 🔒 Security Layers

| Layer | Protection |
|-------|-----------|
| **Helmet** | OWASP security headers (CSP, HSTS, X-Frame-Options, etc.) |
| **CORS** | Strict origin whitelist |
| **Rate Limiting** | Tiered per endpoint (auth: 10/15min, chat: 30/min, clone: 5/hr) |
| **Speed Limiter** | Progressive slowdown after 50 requests |
| **Session Auth** | Secure httpOnly cookies, `__Host-` prefix, SameSite=Strict |
| **CSRF** | Token-based protection on all mutations |
| **Input Sanitization** | XSS, injection, path traversal prevention |
| **SSRF Protection** | Blocks internal/private IPs on clone endpoint |
| **Upload Security** | MIME whitelist, 10MB limit, filename sanitization |
| **UFW Firewall** | Only ports 22, 80, 443 open |
| **Fail2ban** | SSH brute force auto-ban (3 attempts → 24hr ban) |
| **Kernel Hardening** | Anti-spoofing, SYN flood protection, no redirects |
| **SSH Hardening** | Key-only login, 3 max retries, 30s grace |
| **Auto Updates** | Unattended security patches |
| **Nginx** | Rate limiting, security headers, attack pattern blocking |
| **Cloudflare** | WAF, DDoS protection, bot management, SSL/TLS |

## 🤖 Models

- **Qwen 2.5 27B** — Code-focused LLM
- **Ornith 9B** — Fast general chat
- **Ornith 35B** — High-quality reasoning

## 🛠️ Stack

- **Frontend**: Vanilla HTML/CSS/JS (GitHub Pages)
- **Backend**: Express.js + Helmet + rate-limit
- **Models**: vLLM serving HuggingFace models
- **Clone**: Playwright-based authenticated website cloner
- **OCR**: Tesseract.js
- **WebUI**: Open WebUI (Docker)
- **Proxy**: Nginx + Cloudflare

## 🚀 Deploy

### One-Command Server Setup (Ubuntu 22.04+, 64GB+ RAM)
```bash
curl -sSL https://raw.githubusercontent.com/kissik-dom/your-ai-platform/main/setup-server.sh | sudo bash
```

### After Setup
1. Point your domain DNS → server IP (via Cloudflare proxy)
2. `sudo certbot --nginx -d yourdomain.com`
3. Update `.env` with `ALLOWED_ORIGINS=https://yourdomain.com`
4. Enable Cloudflare WAF rules

### Run Security Tests
```bash
node security-test.js
```

## 📁 Structure

```
├── server.js              # Security-hardened Express server
├── package.json           # Dependencies with security libs
├── security-test.js       # Automated security test suite
├── setup-server.sh        # One-command secure server setup
├── .env.example           # Environment variable template
├── .gitignore             # Keeps secrets out of Git
├── public/
│   └── index.html         # Frontend with auth UI
├── cloner/
│   └── deep-clone.js      # Playwright website cloner
└── .github/workflows/
    ├── deploy.yml         # Auto-deploy to server on push
    └── pages.yml          # Auto-deploy frontend to GitHub Pages
```

## License

MIT
