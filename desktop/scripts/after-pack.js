'use strict';

const fs = require('fs');
const path = require('path');

/**
 * electron-builder omits nested node_modules when copying extraResources.
 * The bundled API needs its production dependencies, so copy them explicitly
 * after the app directory has been assembled.
 */
module.exports = async function afterPack(context) {
  const source = path.join(__dirname, '..', 'staging', 'server', 'node_modules');
  const target = path.join(
    context.appOutDir,
    'resources',
    'app',
    'server',
    'node_modules',
  );

  if (!fs.existsSync(source)) {
    throw new Error(
      `Dependências do servidor não encontradas em ${source}. Execute o prepare antes do empacotamento.`,
    );
  }

  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true, dereference: true });
  console.log(`[after-pack] Dependências do servidor copiadas para ${target}`);
};
