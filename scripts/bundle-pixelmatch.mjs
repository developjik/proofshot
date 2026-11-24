import {build} from 'esbuild';
import {copyFileSync,mkdirSync} from 'node:fs';
mkdirSync('dist/vendor', {recursive:true});
await build({entryPoints:['node_modules/pixelmatch/index.js'],bundle:true,platform:'node',format:'cjs',target:'node20',outfile:'dist/vendor/pixelmatch.cjs'});
copyFileSync('node_modules/pixelmatch/LICENSE','dist/vendor/pixelmatch.LICENSE');
