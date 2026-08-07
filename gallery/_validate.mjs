/**
 * Structural validator for the gallery workflow JSONs (SC-004: each imports
 * into n8n without error). Asserts what n8n's importer needs: parseable JSON,
 * required top-level keys, well-formed unique-named nodes, connections that
 * only reference existing nodes, a pdfmill node present, sticky-note docs, and
 * valid embedded sample-data JSON. Exits non-zero on any problem (CI gate).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PDFMILL_TYPE = 'n8n-nodes-pdfmill.pdfmill';
const files = readdirSync(here).filter((f) => f.endsWith('.json'));

if (files.length < 3) {
	console.error(`FAIL: expected >=3 gallery workflows, found ${files.length}`);
	process.exit(1);
}

let problems = 0;
const fail = (file, msg) => {
	console.error(`FAIL [${file}] ${msg}`);
	problems++;
};

for (const file of files) {
	let wf;
	try {
		wf = JSON.parse(readFileSync(join(here, file), 'utf8'));
	} catch (e) {
		fail(file, `not valid JSON: ${e.message}`);
		continue;
	}
	if (typeof wf.name !== 'string' || wf.name === '') fail(file, 'missing name');
	if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) fail(file, 'missing nodes');
	if (!wf.connections || typeof wf.connections !== 'object') fail(file, 'missing connections');

	const names = (wf.nodes ?? []).map((n) => n.name);
	names.filter((n, i) => names.indexOf(n) !== i).forEach((d) => fail(file, `duplicate node name: ${d}`));

	for (const n of wf.nodes ?? []) {
		for (const k of ['id', 'name', 'type', 'typeVersion', 'position', 'parameters']) {
			if (!(k in n)) fail(file, `node "${n.name ?? '?'}" missing "${k}"`);
		}
		if (!Array.isArray(n.position) || n.position.length !== 2) fail(file, `node "${n.name}" bad position`);
		if (n.type === 'n8n-nodes-base.set' && n.parameters?.mode === 'raw') {
			try {
				JSON.parse(n.parameters.jsonOutput);
			} catch {
				fail(file, `node "${n.name}" jsonOutput is not valid JSON`);
			}
		}
	}

	for (const src of Object.keys(wf.connections ?? {})) {
		if (!names.includes(src)) fail(file, `connection from unknown node "${src}"`);
		for (const outs of wf.connections[src].main ?? []) {
			for (const c of outs ?? []) {
				if (!names.includes(c.node)) fail(file, `connection to unknown node "${c.node}"`);
			}
		}
	}

	const pdf = (wf.nodes ?? []).find((n) => n.type === PDFMILL_TYPE);
	if (!pdf) fail(file, 'no pdfmill node');
	else if (!pdf.parameters?.template && !pdf.parameters?.html)
		fail(file, 'pdfmill node has neither template nor html');
	if (!(wf.nodes ?? []).some((n) => n.type === 'n8n-nodes-base.stickyNote'))
		fail(file, 'no sticky-note documentation');
}

if (problems > 0) {
	console.error(`\n${problems} problem(s) across ${files.length} workflow(s).`);
	process.exit(1);
}
console.log(`OK: ${files.length} gallery workflows are structurally import-clean.`);
