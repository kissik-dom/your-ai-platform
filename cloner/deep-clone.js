/**
 * Deep Clone Module
 * Authenticated website cloning via Playwright
 * 
 * Usage:
 *   node cloner/deep-clone.js <url> [--auth] [--pages 10] [--output ./output]
 * 
 * Integrates with:
 *   - hi5jeff/deepclonewebsite (Deep Site Clone)
 *   - ion-design/ditto.site (public URL deterministic clone)
 *   - Playwright for authenticated session capture
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { URL } from 'url';

class DeepCloner {
  constructor(options = {}) {
    this.baseUrl = options.url;
    this.maxPages = options.pages || 10;
    this.outputDir = resolve(options.output || './cloned-site');
    this.requireAuth = options.auth || false;
    this.visited = new Set();
    this.browser = null;
    this.context = null;
    this.page = null;
    this.assets = { css: [], js: [], images: [], fonts: [] };
  }

  log(step, msg) {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] [${step}] ${msg}`);
  }

  async init() {
    this.log('INIT', 'Launching browser...');
    this.browser = await chromium.launch({
      headless: !this.requireAuth, // Visible browser for login
      args: ['--window-size=1440,900']
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    });

    this.page = await this.context.newPage();

    // Ensure output directory
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async authenticate() {
    if (!this.requireAuth) return;

    this.log('AUTH', `Navigating to ${this.baseUrl} for login...`);
    await this.page.goto(this.baseUrl, { waitUntil: 'networkidle' });

    this.log('AUTH', '🔐 Browser is open — please log in manually.');
    this.log('AUTH', '   Waiting up to 2 minutes for login completion...');

    // Wait for a navigation event (user logs in and gets redirected)
    try {
      await this.page.waitForNavigation({ timeout: 120000 });
      this.log('AUTH', '✅ Login detected — continuing with authenticated session.');
    } catch {
      this.log('AUTH', '⚠️ Login timeout — proceeding with current state.');
    }

    // Save cookies for reuse
    const cookies = await this.context.cookies();
    writeFileSync(
      join(this.outputDir, 'cookies.json'),
      JSON.stringify(cookies, null, 2)
    );
    this.log('AUTH', `Saved ${cookies.length} cookies to cookies.json`);
  }

  async clonePage(url) {
    if (this.visited.has(url) || this.visited.size >= this.maxPages) return;
    this.visited.add(url);

    const pageNum = this.visited.size;
    this.log('CLONE', `[${pageNum}/${this.maxPages}] ${url}`);

    try {
      await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await this.page.waitForTimeout(2000); // Let dynamic content settle

      // Extract full HTML
      const html = await this.page.content();

      // Extract inline + external CSS
      const css = await this.page.evaluate(() => {
        const allCSS = [];
        for (const sheet of document.styleSheets) {
          try {
            const rules = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
            allCSS.push({ type: 'inline', css: rules });
          } catch (e) {
            if (sheet.href) allCSS.push({ type: 'external', href: sheet.href });
          }
        }
        return allCSS;
      });

      // Extract all links for crawling
      const links = await this.page.evaluate((base) => {
        const baseUrl = new URL(base);
        return Array.from(document.querySelectorAll('a[href]'))
          .map(a => {
            try { return new URL(a.href, base).href; } catch { return null; }
          })
          .filter(href => href && new URL(href).hostname === baseUrl.hostname);
      }, this.baseUrl);

      // Screenshot
      const screenshot = await this.page.screenshot({ fullPage: true, type: 'png' });

      // Save files
      const safeName = this.urlToFilename(url);
      const pageDir = join(this.outputDir, safeName);
      if (!existsSync(pageDir)) mkdirSync(pageDir, { recursive: true });

      writeFileSync(join(pageDir, 'index.html'), html);
      writeFileSync(join(pageDir, 'styles.css'), css.map(c => c.css || `/* @import url("${c.href}") */`).join('\n\n'));
      writeFileSync(join(pageDir, 'screenshot.png'), screenshot);

      this.log('SAVE', `Saved: ${safeName}/ (HTML + CSS + screenshot)`);

      // Crawl linked pages
      for (const link of links) {
        if (this.visited.size >= this.maxPages) break;
        await this.clonePage(link);
      }

    } catch (err) {
      this.log('ERROR', `Failed to clone ${url}: ${err.message}`);
    }
  }

  urlToFilename(url) {
    const u = new URL(url);
    let path = u.pathname.replace(/\//g, '_').replace(/^_/, '') || 'index';
    return path.substring(0, 80);
  }

  async downloadAssets() {
    this.log('ASSETS', 'Downloading images, fonts, and media...');

    const assets = await this.page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img[src]')).map(i => i.src);
      const videos = Array.from(document.querySelectorAll('video source[src]')).map(v => v.src);
      return { images: imgs.slice(0, 50), videos: videos.slice(0, 10) };
    });

    this.log('ASSETS', `Found ${assets.images.length} images, ${assets.videos.length} videos`);

    const assetsDir = join(this.outputDir, '_assets');
    if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });

    // Download images
    for (const imgUrl of assets.images) {
      try {
        const response = await this.page.request.get(imgUrl);
        const buffer = await response.body();
        const filename = imgUrl.split('/').pop().split('?')[0].substring(0, 60) || 'image.png';
        writeFileSync(join(assetsDir, filename), buffer);
      } catch { /* skip failed downloads */ }
    }

    this.log('ASSETS', 'Asset download complete.');
  }

  async generateManifest() {
    const manifest = {
      clonedAt: new Date().toISOString(),
      sourceUrl: this.baseUrl,
      authenticated: this.requireAuth,
      pagesCloned: this.visited.size,
      pages: Array.from(this.visited),
      outputDir: this.outputDir
    };

    writeFileSync(
      join(this.outputDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    this.log('DONE', `Manifest saved. ${manifest.pagesCloned} pages cloned.`);
  }

  async run() {
    try {
      await this.init();
      await this.authenticate();
      await this.clonePage(this.baseUrl);
      await this.downloadAssets();
      await this.generateManifest();
    } finally {
      if (this.browser) await this.browser.close();
    }
    this.log('DONE', `✅ Clone complete! Output: ${this.outputDir}`);
  }
}

// ── CLI ──
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(`
  Deep Clone — Authenticated Website Cloner
  
  Usage:
    node cloner/deep-clone.js <url> [options]
  
  Options:
    --auth          Open visible browser for manual login
    --pages <n>     Max pages to clone (default: 10)
    --output <dir>  Output directory (default: ./cloned-site)
  
  Examples:
    node cloner/deep-clone.js https://example.com
    node cloner/deep-clone.js https://sephora.com --pages 10
    node cloner/deep-clone.js https://myapp.com --auth --pages 5
  `);
  process.exit(0);
}

const url = args[0];
const auth = args.includes('--auth');
const pagesIdx = args.indexOf('--pages');
const pages = pagesIdx > -1 ? parseInt(args[pagesIdx + 1]) : 10;
const outputIdx = args.indexOf('--output');
const output = outputIdx > -1 ? args[outputIdx + 1] : './cloned-site';

const cloner = new DeepCloner({ url, auth, pages, output });
cloner.run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
