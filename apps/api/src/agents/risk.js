/**
 * Risk agent — rule-based, transparent, citable.
 *
 * Each finding carries:
 *   - severity: critical | high | moderate | low | info
 *   - category: drug-allergy | drug-drug | lab-out-of-range | trend | gap
 *   - cites: [{ resourceType, id }]  — every claim points back to source data
 *
 * This is intentionally NOT an LLM. The LLM is bad at deterministic rule
 * application, and clinicians need to trust that an allergy alert is
 * triggered by an actual matching record, not a hallucination.
 */

const ALLERGY_DRUG_MATCHES = [
  { allergy: /penicillin/i, drugs: [/amoxicillin/i, /ampicillin/i, /penicillin/i, /piperacillin/i, /augmentin/i] },
  { allergy: /sulfa/i, drugs: [/sulfamethoxazole/i, /trimethoprim/i, /bactrim/i, /cotrimoxazole/i] },
  { allergy: /cephalosporin/i, drugs: [/cefuroxime/i, /ceftriaxone/i, /cefixime/i, /cephalexin/i] },
  { allergy: /aspirin/i, drugs: [/aspirin/i, /acetylsalicylic/i] },
  { allergy: /nsaid/i, drugs: [/ibuprofen/i, /naproxen/i, /diclofenac/i] },
];

// Tiny illustrative interaction table — replace with a real KB in prod.
const INTERACTION_PAIRS = [
  { a: /warfarin/i, b: /aspirin/i, severity: 'high', note: 'Increased bleeding risk' },
  { a: /metformin/i, b: /contrast/i, severity: 'high', note: 'Risk of lactic acidosis with iodinated contrast' },
  { a: /telmisartan|losartan|enalapril|lisinopril/i, b: /spironolactone|potassium/i, severity: 'moderate', note: 'Hyperkalemia risk' },
  { a: /glimepiride|glipizide|glyburide/i, b: /insulin/i, severity: 'moderate', note: 'Compounded hypoglycemia risk' },
  { a: /atorvastatin|simvastatin/i, b: /clarithromycin|erythromycin/i, severity: 'high', note: 'Statin myopathy risk' },
];

const LAB_THRESHOLDS = {
  // LOINC code -> { name, criticalHigh?, high?, low?, criticalLow?, unit }
  '4548-4': { name: 'HbA1c', high: 7.0, criticalHigh: 9.0, unit: '%' },
  '8480-6': { name: 'Systolic BP', high: 140, criticalHigh: 180, unit: 'mmHg' },
  '8462-4': { name: 'Diastolic BP', high: 90, criticalHigh: 120, unit: 'mmHg' },
  '2160-0': { name: 'Creatinine', high: 1.3, criticalHigh: 2.5, unit: 'mg/dL' },
  '2823-3': { name: 'Potassium', high: 5.0, criticalHigh: 6.0, low: 3.5, criticalLow: 2.5, unit: 'mEq/L' },
  '33452-4': { name: 'Peak Expiratory Flow', low: 300, unit: 'L/min' },
};

export function runRiskAgent({ findings }) {
  const flags = [];

  flags.push(...checkDrugAllergyConflicts(findings));
  flags.push(...checkDrugDrugInteractions(findings));
  flags.push(...checkLabOutOfRange(findings));
  flags.push(...checkTrendConcerns(findings));

  const ranked = flags.sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity));

  return {
    flags: ranked,
    counts: countBySeverity(ranked),
  };
}

function checkDrugAllergyConflicts(findings) {
  const out = [];
  const allergies = findings.allergies ?? [];
  const meds = findings.currentMedications ?? [];

  for (const allergy of allergies) {
    const allergyText = allergy.substance ?? '';
    const rule = ALLERGY_DRUG_MATCHES.find((r) => r.allergy.test(allergyText));
    if (!rule) continue;

    for (const med of meds) {
      const medText = med.label ?? '';
      if (rule.drugs.some((re) => re.test(medText))) {
        out.push({
          category: 'drug-allergy',
          severity: allergy.criticality === 'high' ? 'critical' : 'high',
          title: `Active medication conflicts with documented allergy`,
          message: `${med.label} — patient is allergic to ${allergy.substance}${allergy.manifestation?.length ? ` (reaction: ${allergy.manifestation.join(', ')})` : ''}.`,
          cites: [
            allergy.cite,
            med.cite,
          ].filter(Boolean),
        });
      }
    }
  }
  return out;
}

function checkDrugDrugInteractions(findings) {
  const out = [];
  const meds = findings.currentMedications ?? [];
  for (let i = 0; i < meds.length; i++) {
    for (let j = i + 1; j < meds.length; j++) {
      const m1 = meds[i].label ?? '';
      const m2 = meds[j].label ?? '';
      for (const pair of INTERACTION_PAIRS) {
        const matches =
          (pair.a.test(m1) && pair.b.test(m2)) ||
          (pair.a.test(m2) && pair.b.test(m1));
        if (matches) {
          out.push({
            category: 'drug-drug',
            severity: pair.severity,
            title: 'Drug-drug interaction',
            message: `${meds[i].label} + ${meds[j].label} — ${pair.note}.`,
            cites: [meds[i].cite, meds[j].cite].filter(Boolean),
          });
        }
      }
    }
  }
  return out;
}

function checkLabOutOfRange(findings) {
  const out = [];
  for (const trend of findings.labTrendInsights ?? []) {
    const threshold = LAB_THRESHOLDS[trend.code];
    if (!threshold) continue;
    const v = trend.latest?.value;
    if (v == null) continue;

    let severity = null;
    let descriptor = null;
    if (threshold.criticalHigh != null && v >= threshold.criticalHigh) {
      severity = 'critical'; descriptor = 'critically high';
    } else if (threshold.high != null && v >= threshold.high) {
      severity = 'high'; descriptor = 'above target';
    } else if (threshold.criticalLow != null && v <= threshold.criticalLow) {
      severity = 'critical'; descriptor = 'critically low';
    } else if (threshold.low != null && v <= threshold.low) {
      severity = 'high'; descriptor = 'below target';
    }
    if (!severity) continue;

    out.push({
      category: 'lab-out-of-range',
      severity,
      title: `${threshold.name} ${descriptor}`,
      message: `Latest ${threshold.name}: ${v} ${trend.latest.unit ?? threshold.unit ?? ''} (target ${threshold.low ?? '≤'}${threshold.high ?? '—'}). Trend ${trend.direction} over ${trend.pointCount} readings.`,
      cites: [{ resourceType: 'Observation', code: trend.code }],
    });
  }
  return out;
}

function checkTrendConcerns(findings) {
  const out = [];
  for (const trend of findings.labTrendInsights ?? []) {
    if (trend.direction === 'increasing' && Math.abs(trend.deltaPct) > 20 && trend.everFlagged) {
      out.push({
        category: 'trend',
        severity: 'moderate',
        title: `${trend.label}: rising trend`,
        message: `${trend.label} has risen ${trend.deltaPct}% across ${trend.pointCount} readings. Consider re-evaluating therapy.`,
        cites: [{ resourceType: 'Observation', code: trend.code }],
      });
    }
  }
  return out;
}

function severityOrder(s) {
  return { critical: 4, high: 3, moderate: 2, low: 1, info: 0 }[s] ?? 0;
}

function countBySeverity(flags) {
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  for (const f of flags) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return counts;
}
