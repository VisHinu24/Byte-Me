import path from 'node:path';
import { existsSync } from 'node:fs';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { logger } from '../config/logger.js';
import { ingestDirectory, resetSyntheaData } from '../services/syntheaIngest.js';

/**
 * CLI:
 *   node src/scripts/ingest-synthea.js                     # uses ./data/synthea/fhir
 *   node src/scripts/ingest-synthea.js --input /path       # custom dir
 *   node src/scripts/ingest-synthea.js --reset             # clear synthea data first
 *   node src/scripts/ingest-synthea.js --source my-system  # tag with custom sourceSystem
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Default search locations: ./data/synthea/fhir, ./data/synthea, ./synthea_output/fhir
  const candidates = args.input
    ? [args.input]
    : [
        path.resolve('data/synthea/fhir'),
        path.resolve('data/synthea'),
        path.resolve('synthea_output/fhir'),
        path.resolve('synthea_output'),
        path.resolve('../../data/synthea/fhir'),
        path.resolve('../../data/synthea'),
      ];

  const dir = candidates.find((c) => existsSync(c));
  if (!dir) {
    logger.error(
      { tried: candidates },
      'No Synthea data found. Generate via Docker (see README) or pass --input <dir>.'
    );
    process.exit(1);
  }

  await connectDb();

  if (args.reset) {
    logger.info({ source: args.source }, 'resetting existing Synthea-sourced data');
    const removed = await resetSyntheaData(args.source);
    logger.info({ removed }, 'reset complete');
  }

  const totals = await ingestDirectory(dir, { sourceSystem: args.source });
  logger.info({ totals }, 'ingest complete');

  await mongoose.disconnect();
}

function parseArgs(argv) {
  const out = { input: null, reset: false, source: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') out.input = argv[++i];
    else if (a === '--reset') out.reset = true;
    else if (a === '--source') out.source = argv[++i];
  }
  return out;
}

main().catch((err) => {
  logger.error({ err: err.message }, 'ingest failed');
  process.exit(1);
});
