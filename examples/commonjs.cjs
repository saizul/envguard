// The package also works with require(). Run after `npm run build`:
//   node examples/commonjs.cjs
const { env, parseEnv, parseDuration } = require('../dist/cjs/index.js');

const result = parseEnv({ PORT: env.port({ default: 3000 }), DEBUG: env.boolean() }, { DEBUG: 'yes' });
console.log(result.ok, result.env);
console.log(parseDuration('1h30m'));
