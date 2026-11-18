'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..');
const serverSource = path.join(repoRoot, 'server');
const clientSource = path.join(repoRoot, 'client', 'dist');
const stagingDir = path.join(desktopDir, 'staging');
const stagingServer = path.join(stagingDir, 'server');
const stagingClient = path.join(stagingDir, 'client');

function fail(message) {
  console.error(`\n[prepare] ${message}\n`);
  process.exit(1);
}

function assertFile(file, hint) {
  if (!fs.existsSync(file)) fail(`${file} não encontrado. ${hint}`);
}

function directorySize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

function formatSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

assertFile(
  path.join(clientSource, 'index.html'),
  'Gere o frontend primeiro com "npm run build" dentro de client/.',
);
assertFile(
  path.join(serverSource, 'index.js'),
  'A pasta server/ parece incompleta.',
);
assertFile(
  path.join(serverSource, 'package-lock.json'),
  'O package-lock.json do servidor é obrigatório para uma instalação reproduzível.',
);
assertFile(
  path.join(desktopDir, 'build', 'icon.ico'),
  'Gere o ícone com o script de ícone ou restaure desktop/build/icon.ico.',
);

console.log('[prepare] Limpando staging...');
fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingServer, { recursive: true });
fs.mkdirSync(path.join(stagingClient, 'dist'), { recursive: true });

console.log('[prepare] Copiando servidor...');
for (const file of ['index.js', 'package.json', 'package-lock.json']) {
  fs.copyFileSync(path.join(serverSource, file), path.join(stagingServer, file));
}
fs.cpSync(path.join(serverSource, 'src'), path.join(stagingServer, 'src'), {
  recursive: true,
});

console.log('[prepare] Copiando frontend compilado...');
fs.cpSync(clientSource, path.join(stagingClient, 'dist'), { recursive: true });

const npmCli =
  process.env.npm_execpath ||
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

console.log('[prepare] Instalando apenas dependências de produção do servidor...');
const install = spawnSync(
  process.execPath,
  [npmCli, 'ci', '--omit=dev', '--no-audit', '--no-fund'],
  {
    cwd: stagingServer,
    stdio: 'inherit',
    windowsHide: true,
    env: process.env,
  },
);
if (install.status !== 0) {
  fail(`Falha ao instalar as dependências do servidor (código ${install.status}).`);
}

// Runtime code never uses the .bin shims, and Windows junctions can break when
// electron-builder copies the tree into resources.
fs.rmSync(path.join(stagingServer, 'node_modules', '.bin'), {
  recursive: true,
  force: true,
});

console.log('[prepare] Validando módulos essenciais...');
const verify = spawnSync(
  process.execPath,
  [
    '-e',
    "require('express'); require('socket.io'); require('bcryptjs'); require('node:sqlite'); console.log('módulos ok');",
  ],
  {
    cwd: stagingServer,
    stdio: 'inherit',
    windowsHide: true,
  },
);
if (verify.status !== 0) {
  fail('As dependências do servidor não puderam ser carregadas.');
}

const serverSize = directorySize(stagingServer);
const clientSize = directorySize(path.join(stagingClient, 'dist'));
console.log(`[prepare] Servidor: ${formatSize(serverSize)}`);
console.log(`[prepare] Frontend: ${formatSize(clientSize)}`);
console.log('[prepare] Staging pronto em desktop/staging.');
