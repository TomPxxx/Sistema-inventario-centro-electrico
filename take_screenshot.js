import puppeteer from 'puppeteer';
import path from 'path';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1024 });

  console.log('Navigating to http://localhost:4000');
  // Log browser console messages
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));

  await page.goto('http://localhost:4000', { waitUntil: 'networkidle2' });

  console.log('Logging in...');
  // Bypass login by injecting the session data directly
  await page.evaluate(() => {
    const mockUser = {
      id: 1,
      nombre_completo: 'Cesar Administrador Global',
      username: 'Cesar',
      rol: 'ADMINISTRADOR',
      sede_id: null,
      sede_nombre: null
    };
    
    // Inject the global user object if it exists
    window.currentUser = mockUser;
    
    // Call the function that launches the software
    if (typeof window.launchSoftwareView === 'function') {
      window.launchSoftwareView(mockUser);
    } else {
      console.error('launchSoftwareView not found!');
    }
  });

  console.log('Waiting for network...');
  await new Promise(r => setTimeout(r, 2000));

  // Dump the DOM of viewAdmin
  const adminHtml = await page.evaluate(() => {
    return document.getElementById('viewAdmin').outerHTML;
  });
  console.log('viewAdmin HTML:', adminHtml.substring(0, 500) + '...');

  console.log('Taking screenshot...');
  const screenshotPath = path.resolve(process.cwd(), 'screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Saved to', screenshotPath);

  await browser.close();
})();
