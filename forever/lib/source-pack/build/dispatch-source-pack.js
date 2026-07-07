// The ONE front door for user material. Every input type — pasted text, uploaded PDF,
// web URL, uploaded image — resolves here to the same SourcePack contract, so the agent
// society downstream never knows or cares where the material came from. Adding an input
// type = adding one ingest module + one case here, nothing else changes.

import { buildTextSourcePack } from './source-pack.js';
import { ingestPdf } from '../../ingest/pdf/ingest-pdf.js';
import { ingestUrl } from '../../ingest/url/ingest-url.js';
import { ingestImage } from '../../ingest/image/ingest-image.js';

export const INPUT_TYPES = Object.freeze(['text', 'pdf', 'url', 'image']);

export async function buildSourcePackFromInput(input, { deps = {}, env = process.env } = {}) {
  switch (input?.type) {
    case 'text':
      return (deps.text ?? buildTextSourcePack)(input.text, { title: input.title });
    case 'pdf':
      return (deps.pdf ?? ingestPdf)(input.path, { env });
    case 'url':
      return (deps.url ?? ingestUrl)(input.url);
    case 'image':
      return (deps.image ?? ingestImage)(input.path, { contextText: input.text ?? '' });
    default:
      throw new Error(`Unknown input type: ${input?.type} (expected ${INPUT_TYPES.join('|')})`);
  }
}
