/**
 * Unit-test harness (Constitution IV). The engine HTTP layer is MOCKED — we
 * stub `helpers.httpRequest` so both operations, loadOptions, binary output,
 * and the full error-map table run green WITHOUT a live engine (SC-002).
 *
 * The stub returns n8n's `returnFullResponse` shape `{ statusCode, headers,
 * body }` — exactly what the real `this.helpers.httpRequest(...)` yields — so
 * the client's real parsing/normalization/error-mapping is exercised; only the
 * transport is a double (the M1 renderer-double pattern).
 */
import type {
	IBinaryData,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
} from 'n8n-workflow';

export const TEST_NODE: INode = {
	id: 'test-node',
	name: 'Generate PDF',
	type: 'n8n-nodes-generate-pdf.generatePdf',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

/** A fake one-page PDF: real magic bytes so binary assertions are meaningful. */
export const FAKE_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'utf8');
/** 1x1 transparent PNG with correct PNG magic. */
export const FAKE_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);

export type FullResponse = { statusCode: number; headers: Record<string, unknown>; body: unknown };
export type HttpStub = (options: IHttpRequestOptions) => Promise<FullResponse> | FullResponse | never;

/** Build a successful /v1/render response (binary body + engine metadata headers). */
export function renderOkResponse(
	bytes: Buffer,
	over: { pages?: number; durationMs?: number; requestId?: string; contentType?: string } = {},
): FullResponse {
	const isPng = bytes.subarray(0, 4).toString('hex') === '89504e47';
	return {
		statusCode: 200,
		headers: {
			'content-type': over.contentType ?? (isPng ? 'image/png' : 'application/pdf'),
			'x-pdfmill-pages': String(over.pages ?? 1),
			'x-pdfmill-duration-ms': String(over.durationMs ?? 42),
			'x-request-id': over.requestId ?? 'req_render_1',
		},
		body: bytes,
	};
}

/** Build a named-error engine response (the `{ error: { code, message, requestId } }` envelope). */
export function engineErrorResponse(
	code: string,
	status: number,
	message = `${code} happened`,
	requestId = `req_${code.toLowerCase()}`,
): FullResponse {
	return {
		statusCode: status,
		headers: { 'content-type': 'application/json', 'x-request-id': requestId },
		body: Buffer.from(JSON.stringify({ error: { code, message, requestId } }), 'utf8'),
	};
}

/** Build a successful /v1/templates response (json:true → parsed object body). */
export function templatesOkResponse(templates: Array<{ id: string; name: string }>): FullResponse {
	return {
		statusCode: 200,
		headers: { 'content-type': 'application/json', 'x-request-id': 'req_templates_1' },
		body: { templates },
	};
}

export interface HarnessOptions {
	items?: Array<{ json: IDataObject; binary?: Record<string, IBinaryData> }>;
	/** Per-parameter values: an object (same for all items) or (name, itemIndex) => value. */
	params?: Record<string, unknown> | ((name: string, itemIndex: number) => unknown);
	credentials?: IDataObject | null;
	continueOnFail?: boolean;
	httpRequest: HttpStub;
	node?: INode;
}

const DEFAULT_CREDENTIALS: IDataObject = { apiKey: 'test-key', baseUrl: 'https://api.pdfmill.test' };

function paramResolver(opts: HarnessOptions) {
	return (name: string, itemIndex: number, fallback?: unknown): unknown => {
		const p = opts.params;
		const value = typeof p === 'function' ? p(name, itemIndex) : p?.[name];
		return value === undefined ? fallback : value;
	};
}

function makeHelpers(opts: HarnessOptions, httpCalls: IHttpRequestOptions[]) {
	return {
		async httpRequest(options: IHttpRequestOptions): Promise<FullResponse> {
			httpCalls.push(options);
			return opts.httpRequest(options);
		},
		async prepareBinaryData(buffer: Buffer, fileName?: string, mimeType?: string): Promise<IBinaryData> {
			const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
			return {
				data: buf.toString('base64'),
				mimeType: mimeType ?? 'application/octet-stream',
				fileName,
				fileExtension: fileName?.includes('.') ? fileName.split('.').pop() : undefined,
			} as IBinaryData;
		},
	};
}

/** Fake IExecuteFunctions for execute() tests. */
export function makeExecuteFunctions(opts: HarnessOptions): {
	ctx: IExecuteFunctions;
	httpCalls: IHttpRequestOptions[];
} {
	const httpCalls: IHttpRequestOptions[] = [];
	const getParam = paramResolver(opts);
	const ctx = {
		getInputData: () => opts.items ?? [{ json: {} }],
		getNode: () => opts.node ?? TEST_NODE,
		continueOnFail: () => opts.continueOnFail ?? false,
		getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) =>
			getParam(name, itemIndex, fallback),
		getCredentials: async () => {
			if (opts.credentials === null) return {} as IDataObject;
			return opts.credentials ?? DEFAULT_CREDENTIALS;
		},
		helpers: makeHelpers(opts, httpCalls),
	} as unknown as IExecuteFunctions;
	return { ctx, httpCalls };
}

/** Fake ILoadOptionsFunctions for the getTemplates loadOptions test. */
export function makeLoadOptionsFunctions(opts: HarnessOptions): {
	ctx: ILoadOptionsFunctions;
	httpCalls: IHttpRequestOptions[];
} {
	const httpCalls: IHttpRequestOptions[] = [];
	const ctx = {
		getNode: () => opts.node ?? TEST_NODE,
		getCurrentNodeParameter: () => undefined,
		getNodeParameter: (_n: string, fallback?: unknown) => fallback,
		getCredentials: async () => {
			if (opts.credentials === null) return {} as IDataObject;
			return opts.credentials ?? DEFAULT_CREDENTIALS;
		},
		helpers: makeHelpers(opts, httpCalls),
	} as unknown as ILoadOptionsFunctions;
	return { ctx, httpCalls };
}

/** Decode a returned binary property back to raw bytes for assertions. */
export function decodeBinary(binary: IBinaryData): Buffer {
	return Buffer.from(binary.data, 'base64');
}
