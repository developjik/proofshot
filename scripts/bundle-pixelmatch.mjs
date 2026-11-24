import {build} from 'esbuild';
import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
mkdirSync('dist/vendor', {recursive:true});
await build({entryPoints:['node_modules/pixelmatch/index.js'],bundle:true,platform:'node',format:'cjs',target:'node20',outfile:'dist/vendor/pixelmatch.cjs'});
copyFileSync('node_modules/pixelmatch/LICENSE','dist/vendor/pixelmatch.LICENSE');
const path='dist/src/diff.js';
const source=readFileSync(path,'utf8');
if(!source.includes('requireFromHere("pixelmatch")'))throw new Error('pixelmatch import not found');
writeFileSync(path,source.replace('requireFromHere("pixelmatch")','requireFromHere("../vendor/pixelmatch.cjs")'));
