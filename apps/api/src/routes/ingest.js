import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import mongoose from 'mongoose';

import { parseHl7Message, hl7ToFhirResources, persistHl7Resources } from '../services/ingest/hl7v2.js';
import { parseCcdaDocument, ccdaToFhirResources, persistCcdaResources } from '../services/ingest/ccda.js';
import { extractFromDocument, persistDocumentExtraction } from '../services/ingest/pdf.js';
import { requireConsent } from '../middleware/consent.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/error.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const textIngestSchema = z.object({
  format: z.enum(['hl7v2', 'ccda']),
  content: z.string().min(1),
});

/**
 * POST /api/Patient/:id/_ingest
 *
 * Body for HL7v2 / CCDA:
 *   { format: 'hl7v2' | 'ccda', content: '...' }
 *
 * For PDF/image: use multipart on /_ingest/file with a `file` field.
 *
 * Returns: { format, counts, preview, sourceMeta }
 *
 * (Underscore prefix instead of FHIR `$` — Express 4's path-to-regexp 0.1
 *  treats `$` as a regex anchor and never matches.)
 */
router.post(
  '/:id/_ingest',
  requireValidPatient,
  requireConsent('*'),
  async (req, res) => {
    const body = textIngestSchema.parse(req.body);
    const patientId = req.params.id;

    let counts, preview, sourceMeta;
    try {
      if (body.format === 'hl7v2') {
        const parsed = parseHl7Message(body.content);
        const resources = hl7ToFhirResources(parsed, patientId);
        counts = await persistHl7Resources(resources);
        preview = buildPreview(resources);
        sourceMeta = { messageType: parsed.messageType, controlId: parsed.controlId, sendingApp: parsed.sendingApp };
      } else {
        const parsed = parseCcdaDocument(body.content);
        const resources = ccdaToFhirResources(parsed, patientId);
        counts = await persistCcdaResources(resources);
        preview = buildPreview(resources);
        sourceMeta = { docId: parsed.docId, title: parsed.title, effectiveTime: parsed.effectiveTime };
      }
    } catch (err) {
      throw new HttpError(400, `Ingest failed: ${err.message}`);
    }

    await recordAudit({
      req,
      action: 'agent.synthesis',
      patientId,
      details: { ingestFormat: body.format, ...counts },
    });

    res.json({ format: body.format, counts, preview, sourceMeta });
  }
);

router.post(
  '/:id/_ingest/file',
  requireValidPatient,
  requireConsent('*'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No file uploaded');
    const patientId = req.params.id;
    const mediaType = req.file.mimetype;

    if (mediaType === 'application/pdf') {
      throw new HttpError(
        400,
        'PDF uploads are not currently supported with the Groq vision backend. ' +
        'Please convert each page to an image (PNG/JPEG/WEBP) and upload it.'
      );
    }
    if (!/^image\/(jpeg|png|webp)/.test(mediaType)) {
      throw new HttpError(400, `Unsupported media type: ${mediaType}`);
    }

    let extraction;
    try {
      extraction = await extractFromDocument({
        buffer: req.file.buffer,
        mediaType,
      });
    } catch (err) {
      throw new HttpError(503, err.message);
    }

    const counts = await persistDocumentExtraction(extraction, patientId, {
      sourceSystem: 'pdf-vision',
      filename: req.file.originalname,
    });

    await recordAudit({
      req,
      action: 'agent.synthesis',
      patientId,
      details: { ingestFormat: 'pdf', filename: req.file.originalname, ...counts },
    });

    res.json({
      format: 'pdf',
      counts,
      extraction,
      sourceMeta: { filename: req.file.originalname, mediaType, size: req.file.size },
    });
  }
);

function requireValidPatient(req, _res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new HttpError(400, 'Invalid patient id');
  }
  next();
}

function buildPreview(resources) {
  const preview = {};
  for (const [type, items] of Object.entries(resources)) {
    if (!items.length) continue;
    preview[type] = items.slice(0, 5).map((r) => ({
      _id: r._id?.toString(),
      label: r.code?.text ?? r.medicationCodeableConcept?.text ?? r.type?.[0]?.text ?? r.class?.display,
      at: r.effectiveDateTime ?? r.authoredOn ?? r.recordedDate ?? r.period?.start,
    }));
  }
  return preview;
}

export default router;
