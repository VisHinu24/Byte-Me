/**
 * Demo provider directory. In production this would be a Practitioner
 * resource registry / HIE provider lookup.
 *
 * The `ref` field is what gets stored on Consent.grantee.reference, which
 * the consent gate matches against the requester's providerId.
 */
export const DEMO_PROVIDERS = [
  {
    ref: 'Practitioner/dr-mehta-cardio',
    name: 'Dr. Anita Mehta',
    specialty: 'Cardiology',
    org: 'Apollo Hospitals · Bengaluru',
  },
  {
    ref: 'Practitioner/dr-rao-endo',
    name: 'Dr. Suresh Rao',
    specialty: 'Endocrinology',
    org: 'Manipal Hospital · Bengaluru',
  },
  {
    ref: 'Practitioner/dr-fernandes-gp',
    name: 'Dr. Linda Fernandes',
    specialty: 'General Medicine',
    org: 'Fortis · Mumbai',
  },
  {
    ref: 'Practitioner/dr-khan-emergency',
    name: 'Dr. Imran Khan',
    specialty: 'Emergency Medicine',
    org: 'AIIMS · Delhi',
  },
  {
    ref: 'Practitioner/dr-iyer-pulm',
    name: 'Dr. Karthik Iyer',
    specialty: 'Pulmonology',
    org: 'Christian Medical College · Vellore',
  },
];

export function findProvider(ref) {
  return DEMO_PROVIDERS.find((p) => p.ref === ref);
}

export const DATA_CATEGORIES = [
  { value: 'demographics', label: 'Demographics', desc: 'Name, age, contact info' },
  { value: 'conditions', label: 'Conditions / diagnoses', desc: 'Active and past diagnoses' },
  { value: 'medications', label: 'Medications', desc: 'Active and historical prescriptions' },
  { value: 'allergies', label: 'Allergies', desc: 'Drug, food, environmental allergies' },
  { value: 'observations', label: 'Labs & observations', desc: 'Lab results, vitals, trends' },
  { value: 'encounters', label: 'Visits & encounters', desc: 'Hospital visits, follow-ups' },
  { value: 'mental-health', label: 'Mental health', desc: 'Sensitive — opt in required', sensitive: true },
  { value: 'reproductive-health', label: 'Reproductive health', desc: 'Sensitive — opt in required', sensitive: true },
  { value: 'genetic', label: 'Genetic / family history', desc: 'Sensitive — opt in required', sensitive: true },
];

export const DURATION_OPTIONS = [
  { value: '1d', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { value: '7d', label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { value: '90d', label: '90 days', ms: 90 * 24 * 60 * 60 * 1000 },
  { value: '1y', label: '1 year', ms: 365 * 24 * 60 * 60 * 1000 },
  { value: 'open', label: 'Open-ended (until revoked)', ms: null },
];
