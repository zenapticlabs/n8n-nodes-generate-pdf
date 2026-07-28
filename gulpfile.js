/**
 * Copy node + credential icons (SVG/PNG) and the node codex (*.node.json) into
 * dist/ after the TS build, so n8n can resolve `icon: 'file:pdfmill.svg'` and
 * the codex metadata at runtime. `tsc` does not copy non-TS assets.
 */
const { src, dest, task } = require('gulp');

task('build:icons', () =>
	src('{nodes,credentials}/**/*.{png,svg,json}', { base: '.' }).pipe(dest('dist')),
);
