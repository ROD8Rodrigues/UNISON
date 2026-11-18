'use strict';

/**
 * UNISON entry point.
 *
 * The original single-file prototype is preserved in ./legacy for reference and
 * its NeDB accounts can be imported with `npm run import:legacy`.
 */
const { main } = require('./src/server');

main();
