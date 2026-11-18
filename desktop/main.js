'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  desktopCapturer,
  dialog,
  session,
  shell,
} = require('electron');
const { fork } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const IS_SMOKE = process.argv.includes('--smoke-test');
const IS_DEV = !app.isPackaged;

app.setName('UNISON');
app.setAppUserModelId('com.unison.desktop');

const DEFAULT_USER_DATA = IS_SMOKE
  ? path.join(os.tmpdir(), `unison-smoke-${Date.now()}`)
  : IS_DEV
    ? path.join(__dirname, '.dev-data')
    : path.join(app.getPath('appData'), 'UNISON');

const USER_DATA = process.env.UNISON_USER_DATA
  ? path.resolve(process.env.UNISON_USER_DATA)
  : DEFAULT_USER_DATA;

function migrateLegacyProfile() {
  if (IS_SMOKE || IS_DEV || process.env.UNISON_USER_DATA) return null;
  const legacyRoot = path.join(app.getPath('appData'), 'Telawork');
  const legacyDb = path.join(legacyRoot, 'data', 'telawork.db');
  const targetDb = path.join(USER_DATA, 'data', 'unison.db');
  if (!fs.existsSync(legacyDb) || fs.existsSync(targetDb)) return null;

  fs.mkdirSync(path.join(USER_DATA, 'data'), { recursive: true });
  fs.mkdirSync(path.join(USER_DATA, 'uploads'), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${legacyDb}${suffix}`;
    if (fs.existsSync(source)) fs.copyFileSync(source, `${targetDb}${suffix}`);
  }

  const legacyUploads = path.join(legacyRoot, 'uploads');
  if (fs.existsSync(legacyUploads)) {
    fs.cpSync(legacyUploads, path.join(USER_DATA, 'uploads'), {
      recursive: true,
      force: true,
    });
  }

  const legacyConfig = path.join(legacyRoot, 'desktop-config.json');
  const targetConfig = path.join(USER_DATA, 'desktop-config.json');
  if (fs.existsSync(legacyConfig) && !fs.existsSync(targetConfig)) {
    fs.copyFileSync(legacyConfig, targetConfig);
  }

  return { from: legacyRoot, to: USER_DATA };
}

const LEGACY_MIGRATION = migrateLegacyProfile();

for (const directory of [
  USER_DATA,
  path.join(USER_DATA, 'data'),
  path.join(USER_DATA, 'uploads'),
  path.join(USER_DATA, 'logs'),
]) {
  fs.mkdirSync(directory, { recursive: true });
}

app.setPath('userData', USER_DATA);

const DATA_DIR = path.join(USER_DATA, 'data');
const UPLOAD_DIR = path.join(USER_DATA, 'uploads');
const LOG_DIR = path.join(USER_DATA, 'logs');
const CONFIG_FILE = path.join(USER_DATA, 'desktop-config.json');
const DESKTOP_LOG = path.join(LOG_DIR, 'desktop.log');
const SERVER_LOG = path.join(LOG_DIR, 'server.log');
const SMOKE_RESULT = path.join(USER_DATA, 'smoke-result.json');
const ICON_PATH = path.join(__dirname, 'build', 'icon.ico');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app', 'server')
  : path.join(REPO_ROOT, 'server');
const CLIENT_INDEX = app.isPackaged
  ? path.join(process.resourcesPath, 'app', 'client', 'dist', 'index.html')
  : path.join(REPO_ROOT, 'client', 'dist', 'index.html');

for (const file of [DESKTOP_LOG, SERVER_LOG]) {
  try {
    if (fs.statSync(file).size > 5 * 1024 * 1024) {
      fs.renameSync(file, `${file}.old`);
    }
  } catch {
    // The file does not exist yet.
  }
}

const desktopLogStream = fs.createWriteStream(DESKTOP_LOG, { flags: 'a' });
const serverLogStream = fs.createWriteStream(SERVER_LOG, { flags: 'a' });
let logsClosed = false;

function stringifyMeta(meta) {
  if (!meta) return '';
  try {
    return ` ${JSON.stringify(meta, (_key, value) => {
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      return value;
    })}`;
  } catch {
    return '';
  }
}

function log(message, meta) {
  const line = `[${new Date().toISOString()}] ${message}${stringifyMeta(meta)}\n`;
  try {
    desktopLogStream.write(line);
  } catch {
    // Logging must never break the app.
  }
  if (IS_DEV) process.stdout.write(line);
}

if (LEGACY_MIGRATION) {
  log('Dados do perfil Telawork migrados para UNISON', LEGACY_MIGRATION);
}

function appendServerLog(chunk) {
  try {
    serverLogStream.write(chunk);
  } catch {
    // Ignore writes after shutdown.
  }
  if (IS_DEV) process.stdout.write(chunk);
}

function closeStream(stream) {
  return new Promise((resolve) => {
    if (!stream || stream.closed || stream.destroyed) {
      resolve();
      return;
    }
    stream.end(resolve);
  });
}

async function closeLogs() {
  if (logsClosed) return;
  logsClosed = true;
  await Promise.all([closeStream(desktopLogStream), closeStream(serverLogStream)]);
}

process.on('uncaughtException', (error) => {
  log('Uncaught exception in desktop process', error);
  try {
    dialog.showErrorBox(
      'UNISON encontrou um erro',
      `${error.message}\n\nDetalhes em:\n${DESKTOP_LOG}`,
    );
  } catch {
    // Dialog may not be available during early startup.
  }
  app.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log('Unhandled rejection in desktop process', reason);
});

function loadDesktopConfig() {
  try {
    const raw = fs
      .readFileSync(CONFIG_FILE, 'utf8')
      .replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (error) {
    if (fs.existsSync(CONFIG_FILE)) {
      log('Desktop config is unreadable; starting with a new one', error);
      try {
        fs.copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.corrupt-${Date.now()}`);
      } catch {
        // Best effort backup.
      }
    }
  }
  return {};
}

function saveDesktopConfig(config) {
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // chmod is a no-op on most Windows filesystems.
  }
}

function ensureJwtSecret(config) {
  if (typeof config.jwtSecret === 'string' && config.jwtSecret.length >= 64) {
    return config.jwtSecret;
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  config.jwtSecret = secret;
  saveDesktopConfig(config);
  return secret;
}

function remoteServerUrl(config) {
  const raw = process.env.UNISON_SERVER_URL || config.serverUrl;
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(String(raw));
  } catch {
    log('Invalid serverUrl in desktop config; using the embedded server');
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    log('serverUrl must use http or https; using the embedded server');
    return null;
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    log('serverUrl must point to the server root; using the embedded server');
    return null;
  }
  const loopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !loopback) {
    log('serverUrl requires HTTPS outside localhost; using the embedded server');
    return null;
  }
  return parsed.origin;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

let serverChild = null;
let serverPort = null;
let serverExited = null;
let mainWindow = null;
let splashWindow = null;
let appOrigin = null;
let shuttingDown = false;

function spawnEmbeddedServer(port, jwtSecret) {
  serverExited = null;
  const child = fork(path.join(SERVER_DIR, 'index.js'), [], {
    cwd: SERVER_DIR,
    execPath: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_PATH: path.join(DATA_DIR, 'unison.db'),
      UPLOAD_DIR: UPLOAD_DIR,
      JWT_SECRET: jwtSecret,
      CORS_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port}`,
      APP_URL: `http://127.0.0.1:${port}`,
      COOKIE_SECURE: 'false',
      EXPOSE_DEV_TOKENS: 'false',
      TRUST_PROXY: 'false',
      SMTP_HOST: process.env.SMTP_HOST || '',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });

  child.stdout.on('data', appendServerLog);
  child.stderr.on('data', appendServerLog);
  child.on('error', (error) => {
    log('Embedded server process error', error);
  });
  child.on('exit', (code, signal) => {
    serverExited = { code, signal };
    log('Embedded server exited', serverExited);
  });
  return child;
}

function checkHealth(port) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/health',
        timeout: 2000,
        headers: { Accept: 'application/json' },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`Health check retornou HTTP ${response.statusCode}`));
            return;
          }
          try {
            const parsed = JSON.parse(body);
            if (parsed.status !== 'ok' || parsed.database !== 'ok') {
              reject(new Error('Banco de dados indisponível'));
              return;
            }
            resolve(parsed);
          } catch {
            reject(new Error('Resposta de health check inválida'));
          }
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('Health check expirou')));
    request.on('error', reject);
  });
}

async function waitForServer(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (serverExited) {
      throw new Error(
        `O servidor encerrou durante a inicialização (código ${serverExited.code}). Consulte ${SERVER_LOG}`,
      );
    }
    try {
      return await checkHealth(port);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw new Error(
    `O servidor local não respondeu: ${lastError ? lastError.message : 'tempo esgotado'}. Consulte ${SERVER_LOG}`,
  );
}

async function startEmbeddedServer(jwtSecret) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await findFreePort();
    log('Starting embedded server', { attempt, port, serverDir: SERVER_DIR });
    serverChild = spawnEmbeddedServer(port, jwtSecret);
    try {
      await waitForServer(port);
      serverPort = port;
      log('Embedded server ready', { port, database: path.join(DATA_DIR, 'unison.db') });
      return port;
    } catch (error) {
      lastError = error;
      log('Embedded server startup failed', error);
      await stopServer();
    }
  }
  throw lastError || new Error('Não foi possível iniciar o servidor local');
}

function stopServer() {
  return new Promise((resolve) => {
    const child = serverChild;
    if (!child || child.exitCode !== null) {
      serverChild = null;
      resolve();
      return;
    }
    let finished = false;
    let timer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      serverChild = null;
      resolve();
    };
    child.once('exit', finish);
    try {
      child.send({ type: 'shutdown' });
    } catch {
      try {
        child.kill();
      } catch {
        // Ignore.
      }
    }
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore.
      }
      setTimeout(finish, 500);
    }, 5000);
  });
}

function httpJson(port, method, requestPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { Accept: 'application/json', ...extraHeaders };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(payload.length);
    }
    const request = http.request(
      { host: '127.0.0.1', port, path: requestPath, method, headers, timeout: 20000 },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            // Keep raw body for error reporting.
          }
          resolve({ status: response.statusCode, body: parsed, raw: data });
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('Requisição expirou')));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function checkRemoteHealth(origin) {
  const target = new URL('/health', origin);
  const client = target.protocol === 'https:' ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const request = client.get(
      target,
      { timeout: 10000, headers: { Accept: 'application/json' } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`Servidor remoto retornou HTTP ${response.statusCode}`));
            return;
          }
          try {
            const parsed = JSON.parse(body);
            if (parsed.status !== 'ok') {
              reject(new Error('Servidor remoto não está saudável'));
              return;
            }
            resolve(parsed);
          } catch {
            reject(new Error('Resposta inválida do servidor remoto'));
          }
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('Servidor remoto não respondeu')));
    request.on('error', reject);
  });
}

function configureSession(origin) {
  const ses = session.defaultSession;
  const allowed = new Set([
    'media',
    'display-capture',
    'fullscreen',
    'notifications',
    'clipboard-sanitized-write',
  ]);

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = (details && details.requestingUrl) || webContents.getURL() || '';
    callback(requestingUrl.startsWith(origin) && allowed.has(permission));
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (!allowed.has(permission)) return false;
    if (!requestingOrigin) return true;
    return requestingOrigin.startsWith(origin);
  });

  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        if (!sources.length) {
          callback({});
          return;
        }
        callback({ video: sources[0], audio: 'loopback' });
      } catch (error) {
        log('Screen capture source selection failed', error);
        callback({});
      }
    },
    { useSystemPicker: true },
  );
}

function splashHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>UNISON</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #0a080d; }
  body {
    display: grid; place-items: center; overflow: hidden;
    font-family: "Segoe UI", Arial, sans-serif; color: #f3eef7;
    -webkit-user-select: none; user-select: none;
  }
  .card { width: 100%; height: 100%; padding: 34px 38px 30px; display: flex; flex-direction: column; justify-content: center; }
  .wordmark { font-size: 30px; font-weight: 800; letter-spacing: 8px; color: #C9A0DC; }
  .subtitle { margin-top: 10px; color: #b3a6bc; font-size: 13px; letter-spacing: .4px; }
  .track { margin-top: 30px; height: 3px; width: 100%; background: #241c2b; border-radius: 999px; overflow: hidden; }
  .bar { height: 100%; width: 40%; border-radius: inherit; background: #C9A0DC; box-shadow: 0 0 18px rgba(201,160,220,.65); animation: load 1.25s ease-in-out infinite; }
  .hint { margin-top: 14px; font-size: 11px; color: #7c6f86; }
  @keyframes load { 0% { transform: translateX(-110%); } 100% { transform: translateX(360%); } }
</style>
</head>
<body>
  <main class="card">
    <div class="wordmark">UNISON</div>
    <div class="subtitle">Comunicação em tempo real</div>
    <div class="track"><div class="bar"></div></div>
    <div class="hint">Iniciando...</div>
  </main>
</body>
</html>`;
}

function showSplash() {
  if (IS_SMOKE) return;
  splashWindow = new BrowserWindow({
    width: 420,
    height: 240,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: true,
    backgroundColor: '#0a080d',
    icon: ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  splashWindow.center();
  splashWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`,
  );
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
}

function createMainWindow(origin) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'UNISON',
    backgroundColor: '#0a080d',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });

  const loaded = new Promise((resolve, reject) => {
    win.webContents.once('did-finish-load', resolve);
    win.webContents.once('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) {
        reject(new Error(`Falha ao carregar ${url}: ${description} (${code})`));
      }
    });
  });

  win.once('ready-to-show', () => {
    closeSplash();
    if (!IS_SMOKE) win.show();
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.on('did-finish-load', () => {
    log('Main window loaded', { url: win.webContents.getURL() });
  });

  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      log('Main window load failed', { code, description, url });
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url) && !url.startsWith(origin)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(origin)) return;
    event.preventDefault();
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
  });

  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    log('Renderer process gone', details);
    if (!IS_SMOKE && !shuttingDown) {
      dialog
        .showMessageBox(win, {
          type: 'error',
          title: 'UNISON',
          message: 'A interface foi encerrada inesperadamente.',
          detail: `Detalhes: ${details.reason}`,
          buttons: ['Recarregar', 'Fechar'],
          defaultId: 0,
        })
        .then(({ response }) => {
          if (response === 0 && !win.isDestroyed()) win.reload();
          else win.close();
        })
        .catch((error) => log('Renderer recovery dialog failed', error));
    }
  });

  win.loadURL(origin).catch((error) => log('loadURL failed', error));
  return { win, loaded };
}

async function runSmokeTest(win, origin) {
  const embedded = Boolean(serverPort);

  const ui = await win.webContents.executeJavaScript(
    `new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const root = document.querySelector('#root');
        const text = document.body ? document.body.innerText.trim() : '';
        const ready =
          /Bem-vindo de volta|Crie sua conta|Conversas|Entrar/i.test(text);
        if (root && root.children.length > 0 && ready) {
          resolve({
            title: document.title,
            rootChildren: root.children.length,
            text: text.slice(0, 160),
            url: location.href,
          });
          return;
        }
        if (Date.now() - started > 20000) {
          reject(new Error('A interface não renderizou a tela inicial em 20 segundos'));
          return;
        }
        setTimeout(check, 150);
      };
      check();
    })`,
    true,
  );

  let screenshotBytes = 0;
  try {
    // Chromium pauses CSS animations while the window is hidden. Show it with
    // zero opacity so the auth-card entrance animation actually completes.
    if (IS_SMOKE) {
      win.setOpacity(0);
      win.showInactive();
    }
    await delay(900);
    const screenshot = await win.webContents.capturePage();
    const png = screenshot.toPNG();
    screenshotBytes = png.length;
    if (png.length > 1000) {
      fs.writeFileSync(path.join(USER_DATA, 'smoke-screenshot.png'), png);
    }
  } catch (error) {
    log('Smoke screenshot failed', error);
  }

  let displayMedia = null;
  try {
    if (IS_SMOKE) {
      win.setOpacity(0);
      win.showInactive();
    }
    displayMedia = await win.webContents.executeJavaScript(
      `(async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          return { supported: false };
        }
        const timeout = new Promise((resolve) =>
          setTimeout(() => resolve({ supported: true, timeout: true }), 8000),
        );
        const capture = navigator.mediaDevices
          .getDisplayMedia({ video: true, audio: true })
          .then((stream) => {
            const result = {
              supported: true,
              videoTracks: stream.getVideoTracks().length,
              audioTracks: stream.getAudioTracks().length,
              audioLabel: (stream.getAudioTracks()[0] || {}).label || null,
            };
            stream.getTracks().forEach((track) => track.stop());
            return result;
          })
          .catch((error) => ({
            supported: true,
            error: String(error && error.name ? error.name + ': ' + error.message : error),
          }));
        return Promise.race([capture, timeout]);
      })()`,
      true,
    );
  } catch (error) {
    displayMedia = { error: String(error) };
  } finally {
    if (IS_SMOKE) win.hide();
  }

  if (!embedded) {
    return {
      origin,
      mode: 'remote',
      ui,
      screenshotBytes,
      displayMedia,
      health: await checkRemoteHealth(origin),
    };
  }

  const suffix = Date.now().toString(36);
  const password = `Smoke-${crypto.randomBytes(8).toString('hex')}`;
  const registration = await httpJson(serverPort, 'POST', '/api/auth/register', {
    username: `smoke_${suffix}`,
    email: `smoke_${suffix}@unison.test`,
    password,
    displayName: 'Smoke Test',
  });

  if (registration.status !== 201 || !registration.body || !registration.body.accessToken) {
    throw new Error(
      `Registro falhou (HTTP ${registration.status}): ${registration.raw.slice(0, 300)}`,
    );
  }

  const me = await httpJson(
    serverPort,
    'GET',
    '/api/auth/me',
    null,
    { Authorization: `Bearer ${registration.body.accessToken}` },
  );

  if (me.status !== 200 || !me.body || !me.body.user) {
    throw new Error(`/api/auth/me falhou (HTTP ${me.status}): ${me.raw.slice(0, 300)}`);
  }

  const uiCredentials = {
    username: `smokeui_${suffix}`,
    email: `smokeui_${suffix}@unison.test`,
    password,
    displayName: 'Smoke UI',
  };
  const cookieTest = await win.webContents.executeJavaScript(
    `(async () => {
      const credentials = ${JSON.stringify(uiCredentials)};
      const register = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      const registration = await register.json().catch(() => null);
      const refresh = await fetch('/api/auth/refresh', { method: 'POST' });
      const refreshed = await refresh.json().catch(() => null);
      const token =
        (refreshed && refreshed.accessToken) ||
        (registration && registration.accessToken) ||
        '';
      const me = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + token },
      });
      const profile = await me.json().catch(() => null);
      return {
        registerStatus: register.status,
        refreshStatus: refresh.status,
        meStatus: me.status,
        userId: profile && profile.user ? profile.user.id : null,
      };
    })()`,
    true,
  );

  if (
    cookieTest.registerStatus !== 201 ||
    cookieTest.refreshStatus !== 200 ||
    cookieTest.meStatus !== 200
  ) {
    throw new Error(`Fluxo de cookie no renderer falhou: ${JSON.stringify(cookieTest)}`);
  }

  const cookies = await session.defaultSession.cookies.get({
    url: `${origin}/api/auth/refresh`,
    name: 'unison_refresh',
  });
  const refreshCookie = cookies[0];
  if (!refreshCookie || !refreshCookie.httpOnly || refreshCookie.secure) {
    throw new Error(
      `Cookie de refresh inesperado: ${JSON.stringify(refreshCookie || null)}`,
    );
  }

  return {
    origin,
    mode: 'embedded',
    ui,
    screenshotBytes,
    displayMedia,
    api: {
      registerStatus: registration.status,
      meStatus: me.status,
      userId: me.body.user.id,
      username: me.body.user.username,
    },
    renderer: {
      registerStatus: cookieTest.registerStatus,
      refreshStatus: cookieTest.refreshStatus,
      meStatus: cookieTest.meStatus,
      userId: cookieTest.userId,
    },
    cookie: {
      httpOnly: refreshCookie.httpOnly,
      secure: refreshCookie.secure,
      sameSite: refreshCookie.sameSite,
      path: refreshCookie.path,
    },
  };
}

async function finishSmokeTest(code, result) {
  try {
    fs.writeFileSync(
      SMOKE_RESULT,
      `${JSON.stringify(
        {
          ok: code === 0,
          finishedAt: new Date().toISOString(),
          ...result,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  } catch (error) {
    log('Could not write smoke result', error);
  }
  log(code === 0 ? 'SMOKE_OK' : 'SMOKE_FAIL', result);
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  } catch {
    // Ignore.
  }
  closeSplash();
  await stopServer();
  await closeLogs();
  app.exit(code);
}

function openPath(target, label) {
  void shell.openPath(target).then((error) => {
    if (error) log(`Could not open ${label}`, { target, error });
  });
}

async function openServerConfiguration() {
  const config = loadDesktopConfig();
  if (!fs.existsSync(CONFIG_FILE)) saveDesktopConfig(config);
  const detail = [
    'Sem "serverUrl", o UNISON usa o servidor local embutido e os dados ficam somente neste computador.',
    '',
    'Para conectar todos os usuários ao mesmo servidor, edite o campo "serverUrl" e reinicie o aplicativo:',
    '"serverUrl": "https://chat.suaempresa.com"',
    '',
    `Arquivo: ${CONFIG_FILE}`,
    '',
    'O servidor remoto precisa estar publicado com HTTPS e o mesmo backend do UNISON.',
  ].join('\n');
  const options = {
    type: 'info',
    title: 'Servidor do UNISON',
    message: 'Configuração de servidor',
    detail,
    buttons: ['Abrir arquivo de configuração', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (result.response === 0) openPath(CONFIG_FILE, 'desktop config');
}

function showAbout() {
  const options = {
    type: 'info',
    title: 'Sobre o UNISON',
    message: 'UNISON',
    detail: [
      `Versão ${app.getVersion()}`,
      appOrigin && serverPort
        ? 'Modo: servidor local embutido'
        : appOrigin
          ? `Modo: servidor remoto (${appOrigin})`
          : 'Modo: iniciando',
      '',
      `Dados: ${USER_DATA}`,
      `Logs: ${LOG_DIR}`,
    ].join('\n'),
    buttons: ['Fechar'],
  };
  if (mainWindow) void dialog.showMessageBox(mainWindow, options);
  else void dialog.showMessageBox(options);
}

function buildMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Abrir pasta de dados',
          click: () => openPath(USER_DATA, 'data folder'),
        },
        {
          label: 'Abrir pasta de logs',
          click: () => openPath(LOG_DIR, 'logs folder'),
        },
        { type: 'separator' },
        {
          label: 'Configurar servidor...',
          click: () => {
            void openServerConfiguration();
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'forceReload', label: 'Forçar recarregamento' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamanho normal' },
        { role: 'zoomIn', label: 'Ampliar' },
        { role: 'zoomOut', label: 'Reduzir' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
        ...(IS_DEV
          ? [{ type: 'separator' }, { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' }]
          : []),
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Sobre o UNISON',
          click: showAbout,
        },
        {
          label: 'Abrir pasta de logs',
          click: () => openPath(LOG_DIR, 'logs folder'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function bootstrap() {
  try {
    if (!fs.existsSync(CLIENT_INDEX)) {
      throw new Error(
        app.isPackaged
          ? `O frontend compilado não foi encontrado em ${CLIENT_INDEX}. Reinstale o UNISON.`
          : `O build do frontend não foi encontrado em ${CLIENT_INDEX}. Execute "npm run build" na pasta client antes de abrir o aplicativo.`,
      );
    }

    const config = loadDesktopConfig();
    const remote = remoteServerUrl(config);
    const useRemote =
      remote && (!IS_SMOKE || process.env.UNISON_SMOKE_REMOTE === '1');

    if (useRemote) {
      appOrigin = remote;
      log('Using remote server', { origin: remote, configFile: CONFIG_FILE });
    } else {
      const jwtSecret = ensureJwtSecret(config);
      await startEmbeddedServer(jwtSecret);
      appOrigin = `http://127.0.0.1:${serverPort}`;
    }

    configureSession(appOrigin);
    buildMenu();

    const created = createMainWindow(appOrigin);
    mainWindow = created.win;
    await created.loaded;

    if (IS_SMOKE) {
      try {
        const result = await runSmokeTest(mainWindow, appOrigin);
        await finishSmokeTest(0, result);
      } catch (error) {
        await finishSmokeTest(1, { error: error.stack || String(error) });
      }
    }
  } catch (error) {
    log('Startup failed', error);
    closeSplash();
    if (IS_SMOKE) {
      await finishSmokeTest(1, { error: error.stack || String(error) });
      return;
    }
    try {
      dialog.showErrorBox(
        'UNISON não pôde iniciar',
        `${error.message}\n\nServidor: ${SERVER_LOG}\nAplicativo: ${DESKTOP_LOG}`,
      );
    } catch {
      // Ignore dialog failures.
    }
    await stopServer();
    await closeLogs();
    app.exit(1);
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    if (!serverChild) {
      if (!logsClosed) {
        event.preventDefault();
        shuttingDown = true;
        void closeLogs().finally(() => app.quit());
      }
      return;
    }
    event.preventDefault();
    shuttingDown = true;
    void stopServer()
      .then(closeLogs)
      .finally(() => app.quit());
  });

  app
    .whenReady()
    .then(() => {
      log('Desktop starting', {
        version: app.getVersion(),
        packaged: app.isPackaged,
        userData: USER_DATA,
        serverDir: SERVER_DIR,
        smoke: IS_SMOKE,
      });
      showSplash();
      return bootstrap();
    })
    .catch((error) => {
      log('Fatal desktop startup error', error);
      closeSplash();
      try {
        dialog.showErrorBox('UNISON não pôde iniciar', String(error));
      } catch {
        // Ignore dialog failures.
      }
      void stopServer()
        .then(closeLogs)
        .finally(() => app.exit(1));
    });
}
