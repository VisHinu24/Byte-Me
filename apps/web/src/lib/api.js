const BASE = import.meta.env.VITE_API_URL ?? '';

/**
 * Demo impersonation. The dev server reads X-Dev-User and constructs a
 * synthetic auth identity. Format: "role:id:displayName".
 */
const IMPERSONATION_KEY = 'pml.devUser';

export function getImpersonation() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(IMPERSONATION_KEY);
}
export function setImpersonation(value) {
  if (typeof localStorage === 'undefined') return;
  if (value) localStorage.setItem(IMPERSONATION_KEY, value);
  else localStorage.removeItem(IMPERSONATION_KEY);
}

function authHeaders() {
  const dev = getImpersonation();
  return dev ? { 'X-Dev-User': dev } : {};
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers ?? {}) },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  health: () => request('/health'),
  me: () => request('/api/me'),
  // Demo-only — used by impersonation switcher to enumerate patient identities.
  demoListPatients: () => request('/api/_demo/patients'),
  listPatients: (q = '') =>
    request(`/api/Patient${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getPatient: (id) => request(`/api/Patient/${id}`),
  getSummary: (id) => request(`/api/Patient/${id}/_summary`),
  getEncounters: (id) => request(`/api/Patient/${id}/Encounter`),
  getConditions: (id) => request(`/api/Patient/${id}/Condition`),
  getMedications: (id) => request(`/api/Patient/${id}/MedicationRequest`),
  getObservations: (id, code) =>
    request(`/api/Patient/${id}/Observation${code ? `?code=${code}` : ''}`),
  getAudit: (patientId) =>
    request(`/api/AuditLog${patientId ? `?patientId=${patientId}` : ''}`),

  listConsents: (patientId) =>
    request(`/api/Consent${patientId ? `?patientId=${patientId}` : ''}`),
  grantConsent: (body) =>
    request('/api/Consent', { method: 'POST', body: JSON.stringify(body) }),
  revokeConsent: (id) =>
    request(`/api/Consent/${id}`, { method: 'DELETE' }),

  getResource: (type, id) => request(`/api/Resource/${type}/${id}`),

  listMemories: (patientId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/Patient/${patientId}/DerivedMemory${qs ? `?${qs}` : ''}`);
  },
  distillMemories: (patientId) =>
    request(`/api/Patient/${patientId}/_distill`, { method: 'POST', body: '{}' }),
  updateMemoryStatus: (id, body) =>
    request(`/api/DerivedMemory/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),

  ingestText: (patientId, format, content) =>
    request(`/api/Patient/${patientId}/_ingest`, {
      method: 'POST',
      body: JSON.stringify({ format, content }),
    }),

  prescribe: (patientId, body) =>
    request(`/api/Patient/${patientId}/_prescribe`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

/**
 * Streams the synthesized brief via Server-Sent Events.
 *
 * Returns an abort fn. The onEvent callback receives the parsed JSON
 * event objects emitted by the orchestrator.
 */
export function streamBrief(patientId, { complaint, onEvent, onError, onClose }) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/api/Patient/${patientId}/_brief`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...authHeaders(),
        },
        body: JSON.stringify({ complaint }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Brief stream failed (${res.status}): ${body}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const block of events) {
          const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const json = dataLine.slice(5).trim();
          if (!json) continue;
          try {
            onEvent?.(JSON.parse(json));
          } catch {
            // ignore malformed event
          }
        }
      }
      onClose?.();
    } catch (err) {
      if (err.name !== 'AbortError') onError?.(err);
    }
  })();

  return () => controller.abort();
}
