import * as esbuild from 'esbuild';
import { rm } from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pkg = require('./package.json');

async function build() {
    console.log('Cleaning dist...');
    await rm('dist', { recursive: true, force: true });

    console.log('Building...');
    await esbuild.build({
        entryPoints: [
            'src/instances/api.ts',
            'src/instances/payment.ts',
            'src/workers/webhook.worker.ts'
        ],
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'esm',
        outdir: 'dist',
        external: [
            ...Object.keys(pkg.dependencies || {}),
            ...Object.keys(pkg.peerDependencies || {}),
            // Externalize explicitly to be safe
            'pg',
            'argon2',
            'bun:sqlite'
        ],
        sourcemap: true,
        logLevel: 'info',
        banner: {
            js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
        },
        alias: {
            '@': path.resolve(__dirname, 'src'),
            'fintech-ledger': path.resolve(__dirname, 'libs/fintech-ledger/src/index.ts')
        },
        plugins: [
            // Simple plugin to handle wildcard replacements if needed, 
            // but 'alias' above handles the prefix replacement for '@/' -> 'src/'
        ]
    });

    console.log('Build complete');
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});
