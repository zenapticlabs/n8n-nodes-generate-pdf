import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INode,
	type INodeExecutionData,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

import {
	engineListTemplates,
	engineRender,
	EngineError,
	type EngineContext,
	type RenderInput,
} from './engineClient';

/** Per-code, plain-language hint surfaced alongside the engine's own message (Principle V). */
function descriptionForCode(code: string): string | undefined {
	switch (code) {
		case 'UNAUTHORIZED':
			return 'The pdfmill API key is missing or invalid — check the node’s credential.';
		case 'QUOTA_EXCEEDED':
			return 'Your monthly document cap is reached — upgrade your plan or wait for the next period.';
		case 'RENDER_TIMEOUT':
			return 'The document took too long to render — simplify the template or reduce its size.';
		case 'TEMPLATE_NOT_FOUND':
			return 'No template with that ID exists in your account — pick one from the dropdown.';
		case 'PAYLOAD_TOO_LARGE':
			return 'The request data is too large — reduce the payload.';
		case 'OUTPUT_TOO_LARGE':
			return 'The rendered document exceeded the size limit.';
		case 'RENDER_FAILED':
			return 'The engine could not render this input — check the template/HTML and data.';
		case 'BUSY':
			return 'The engine is rate-limited or at capacity — retry with backoff.';
		case 'ENGINE_UNREACHABLE':
			return 'Could not reach the pdfmill engine — check the Base URL and network.';
		default:
			return undefined;
	}
}

/**
 * Map any thrown error to the right n8n error (FR-006, Principle V):
 *  - already an n8n error → passed through
 *  - EngineError kind 'api' (the engine returned a named error) → NodeApiError,
 *    carrying the httpCode + the engine's own message; the code + requestId are
 *    embedded in the surfaced message so support can trace the exact render.
 *  - EngineError kind 'config' | 'transport' (bad credential / engine
 *    unreachable) → NodeOperationError with an exact, deterministic message the
 *    user can act on (n8n does not rewrite these).
 *  - anything else → NodeOperationError.
 * Every mapped error keeps the engine's code + message + requestId — nothing swallowed.
 */
function toNodeError(node: INode, error: unknown, itemIndex: number): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;

	if (error instanceof EngineError) {
		const withId = error.requestId ? ` (requestId: ${error.requestId})` : '';
		const message = `${error.message} [${error.code}]${withId}`;
		if (error.kind === 'config' || error.kind === 'transport') {
			// n8n prettifies known transport messages (e.g. ECONNREFUSED) on
			// `.message`; the machine code therefore rides `.description`, which n8n
			// never rewrites — so the code is ALWAYS visible to the user (SC-006).
			const hint =
				error.kind === 'config'
					? 'Check the node’s pdfmill credential (API key + Base URL).'
					: (descriptionForCode(error.code) ?? 'Could not reach the pdfmill engine.');
			return new NodeOperationError(node, message, {
				itemIndex,
				description: `${hint} [${error.code}]`,
			});
		}
		const engineResponse: JsonObject = {
			code: error.code,
			message: error.message,
			requestId: error.requestId ?? null,
		};
		return new NodeApiError(node, engineResponse, {
			message,
			httpCode: error.httpStatus !== undefined ? String(error.httpStatus) : undefined,
			description: descriptionForCode(error.code),
			itemIndex,
		});
	}

	const message = error instanceof Error ? error.message : String(error);
	return new NodeOperationError(node, message, { itemIndex });
}

/** The engine code (or a synthetic one) for the Continue-On-Fail JSON branch. */
function errorCodeOf(error: unknown): string {
	if (error instanceof EngineError) return error.code;
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return 'NODE_ERROR';
	return 'ERROR';
}

function errorRequestIdOf(error: unknown): string | null {
	return error instanceof EngineError && error.requestId ? error.requestId : null;
}

/** Read the Data parameter as an object, whether it arrived as an object or a JSON string. */
function readData(ctx: IExecuteFunctions, node: INode, itemIndex: number): IDataObject {
	const raw = ctx.getNodeParameter('data', itemIndex, {}) as unknown;
	if (raw === null || raw === undefined) return {};
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (trimmed === '') return {};
		try {
			const parsed = JSON.parse(trimmed);
			return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
				? (parsed as IDataObject)
				: {};
		} catch {
			throw new NodeOperationError(node, 'Data is not valid JSON.', { itemIndex });
		}
	}
	if (typeof raw === 'object' && !Array.isArray(raw)) return raw as IDataObject;
	return {};
}

/** Split the Options collection into the engine render options and the node-only file name. */
function buildOptions(o: IDataObject): { engineOptions: IDataObject; fileNameOverride?: string } {
	const engineOptions: IDataObject = {};
	if (typeof o.pageSize === 'string' && o.pageSize !== '') engineOptions.pageSize = o.pageSize;
	if (typeof o.landscape === 'boolean') engineOptions.landscape = o.landscape;
	if (typeof o.printBackground === 'boolean') engineOptions.printBackground = o.printBackground;
	if (typeof o.scale === 'number') engineOptions.scale = o.scale;

	const margin: IDataObject = {};
	const sides: Array<[keyof IDataObject, string]> = [
		['marginTop', 'top'],
		['marginRight', 'right'],
		['marginBottom', 'bottom'],
		['marginLeft', 'left'],
	];
	for (const [key, side] of sides) {
		const v = o[key];
		if (typeof v === 'string' && v.trim() !== '') margin[side] = v.trim();
	}
	if (Object.keys(margin).length > 0) engineOptions.margin = margin;

	const fileNameOverride = typeof o.fileName === 'string' && o.fileName.trim() !== '' ? o.fileName.trim() : undefined;
	return { engineOptions, fileNameOverride };
}

/** Filesystem-safe base name for the default output file. */
function sanitizeFileBase(label: string): string {
	const cleaned = label.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
	return cleaned.length > 0 ? cleaned : 'document';
}

export class GeneratePdf implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Generate PDF',
		name: 'generatePdf',
		icon: { light: 'file:pdfmill.svg', dark: 'file:pdfmill.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] === "template" ? "From Template" : "From HTML" }}',
		description: 'Generate a branded PDF or PNG from a pdfmill template or raw HTML.',
		defaults: {
			name: 'Generate PDF',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'pdfmillApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Generate From Template',
						value: 'template',
						description: 'Render one of your pdfmill templates with data',
						action: 'Generate a document from a template',
					},
					{
						name: 'Generate From HTML',
						value: 'html',
						description: 'Render raw HTML (with optional handlebars variables) to a document',
						action: 'Generate a document from HTML',
					},
				],
				default: 'template',
			},
			{
				displayName: 'Template Name or ID',
				name: 'template',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: {
					loadOptionsMethod: 'getTemplates',
				},
				default: '',
				required: true,
				hint: 'Pick a pdfmill template; the Invoice starter is a good first choice.',
				displayOptions: {
					show: {
						operation: ['template'],
					},
				},
			},
			{
				displayName: 'HTML',
				name: 'html',
				type: 'string',
				typeOptions: {
					rows: 6,
				},
				default: '',
				required: true,
				description:
					'The HTML to render. Supports {{handlebars}} variables filled from Data. Usually an expression that maps HTML from an earlier node.',
				displayOptions: {
					show: {
						operation: ['html'],
					},
				},
			},
			{
				displayName: 'Data',
				name: 'data',
				type: 'json',
				default: '={{ $json }}',
				description:
					'Data merged into the template/HTML variables. Defaults to the incoming item’s JSON; use an expression to map specific fields.',
			},
			{
				displayName: 'Format',
				name: 'format',
				type: 'options',
				options: [
					{
						name: 'PDF',
						value: 'pdf',
					},
					{
						name: 'PNG',
						value: 'png',
					},
				],
				default: 'pdf',
				description: 'Output format of the rendered document',
			},
			{
				displayName: 'Put Output File in Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description: 'The name of the output binary field to put the rendered document in, so it can flow to email, Drive, etc',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'File Name',
						name: 'fileName',
						type: 'string',
						default: '',
						description: 'Name for the output file. Defaults to the template name (or "document") plus the format extension.',
					},
					{
						displayName: 'Landscape',
						name: 'landscape',
						type: 'boolean',
						default: false,
						description: 'Whether to render in landscape orientation',
					},
					{
						displayName: 'Margin Bottom',
						name: 'marginBottom',
						type: 'string',
						default: '',
						placeholder: '1cm',
						description: 'Bottom page margin, as a CSS length (e.g. 1cm, 12mm, 0.5in)',
					},
					{
						displayName: 'Margin Left',
						name: 'marginLeft',
						type: 'string',
						default: '',
						placeholder: '1cm',
						description: 'Left page margin, as a CSS length (e.g. 1cm, 12mm, 0.5in)',
					},
					{
						displayName: 'Margin Right',
						name: 'marginRight',
						type: 'string',
						default: '',
						placeholder: '1cm',
						description: 'Right page margin, as a CSS length (e.g. 1cm, 12mm, 0.5in)',
					},
					{
						displayName: 'Margin Top',
						name: 'marginTop',
						type: 'string',
						default: '',
						placeholder: '1cm',
						description: 'Top page margin, as a CSS length (e.g. 1cm, 12mm, 0.5in)',
					},
					{
						displayName: 'Page Size',
						name: 'pageSize',
						type: 'options',
						options: [
							{ name: 'A3', value: 'A3' },
							{ name: 'A4', value: 'A4' },
							{ name: 'A5', value: 'A5' },
							{ name: 'Legal', value: 'Legal' },
							{ name: 'Letter', value: 'Letter' },
							{ name: 'Tabloid', value: 'Tabloid' },
						],
						default: 'A4',
						description: 'Paper size for PDF output',
					},
					{
						displayName: 'Print Background',
						name: 'printBackground',
						type: 'boolean',
						default: true,
						description: 'Whether to print background colors and images',
					},
					{
						displayName: 'Scale',
						name: 'scale',
						type: 'number',
						typeOptions: {
							minValue: 0.1,
							maxValue: 2,
						},
						default: 1,
						description: 'Render scale, between 0.1 and 2',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const templates = await engineListTemplates(this as EngineContext);
					return templates.map((t) => ({ name: t.name, value: t.id }));
				} catch (error) {
					throw toNodeError(this.getNode(), error, 0);
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const node = this.getNode();
		const operation = this.getNodeParameter('operation', 0) as string;
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const format = this.getNodeParameter('format', i) as 'pdf' | 'png';
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
				const data = readData(this, node, i);
				const optionsParam = this.getNodeParameter('options', i, {}) as IDataObject;
				const { engineOptions, fileNameOverride } = buildOptions(optionsParam);

				const input: RenderInput = { data, format, options: engineOptions };
				let label: string;
				if (operation === 'template') {
					const template = ((this.getNodeParameter('template', i) as string) || '').trim();
					if (template === '') {
						throw new NodeOperationError(node, 'No template selected — pick a template or set a template ID.', {
							itemIndex: i,
						});
					}
					input.template = template;
					label = template;
				} else {
					const html = this.getNodeParameter('html', i) as string;
					if (typeof html !== 'string' || html.trim() === '') {
						throw new NodeOperationError(node, 'HTML is empty — provide HTML to render.', { itemIndex: i });
					}
					input.html = html;
					label = 'document';
				}

				const result = await engineRender(this as EngineContext, input);
				const ext = format === 'png' ? 'png' : 'pdf';
				const fileName = fileNameOverride ?? `${sanitizeFileBase(label)}.${ext}`;
				const binaryData = await this.helpers.prepareBinaryData(result.bytes, fileName, result.contentType);

				returnData.push({
					json: {
						success: true,
						source: operation,
						template: operation === 'template' ? label : null,
						format,
						pages: result.pages,
						bytes: result.bytes.length,
						durationMs: result.durationMs,
						requestId: result.requestId,
						fileName,
						mimeType: result.contentType,
					},
					binary: {
						[binaryPropertyName]: binaryData,
					},
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					const nodeError = toNodeError(node, error, i);
					returnData.push({
						json: {
							success: false,
							error: nodeError.message,
							code: errorCodeOf(error),
							requestId: errorRequestIdOf(error),
						},
						pairedItem: { item: i },
					});
					continue;
				}
				throw toNodeError(node, error, i);
			}
		}

		return [returnData];
	}
}
