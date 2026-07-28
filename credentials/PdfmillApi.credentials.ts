import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * pdfmill API credential (FR-002).
 *
 * The API key rides n8n's credential system — it is never a node parameter and
 * never logged (Principle III). `authenticate` injects it as the `x-api-key`
 * header on every request the node makes; `test` lets n8n's "Test credential"
 * button verify the key against the engine's auth-gated GET /v1/templates
 * (200 = valid, 401 = bad key) before the user builds a workflow.
 *
 * `baseUrl` defaults to the hosted engine and is overridable for self-hosted
 * pdfmill (a future scenario the credential already supports).
 */
export class PdfmillApi implements ICredentialType {
	name = 'pdfmillApi';

	displayName = 'Pdfmill API';

	documentationUrl = 'https://pdfmill.dev/docs/n8n';

	icon: Icon = { light: 'file:pdfmill.svg', dark: 'file:pdfmill.svg' };

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your pdfmill API key, created in the pdfmill dashboard under API Keys.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.pdfmill.dev',
			description:
				'The pdfmill engine base URL. Leave as-is for hosted pdfmill; change it only for a self-hosted engine.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/templates',
			method: 'GET',
		},
	};
}
