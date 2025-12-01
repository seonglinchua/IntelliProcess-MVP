import React, { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'kyc_artifact_data';
const DEFAULT_TEXT = `--- Passport OCR Mock Data ---\nName: Jane Doe\nPassport No: X1234567\nNationality: USA\nIssue Date: 2021-05-17\nExpiry Date: 2031-05-16\nPlace of Issue: Washington D.C.`;

const schemaDescription = [
  {
    field: 'applicantName',
    type: 'STRING',
    description: 'The full name of the applicant.',
  },
  {
    field: 'documentId',
    type: 'STRING',
    description: 'The unique document identification number.',
  },
  {
    field: 'issueDate',
    type: 'STRING',
    format: 'YYYY-MM-DD',
    description: 'The date the document was issued.',
  },
];

const statusThemes = {
  info: 'bg-blue-900/60 text-blue-100 border border-blue-700/60',
  success: 'bg-emerald-900/60 text-emerald-100 border border-emerald-700/60',
  warning: 'bg-amber-900/60 text-amber-100 border border-amber-700/60',
  danger: 'bg-rose-900/60 text-rose-100 border border-rose-700/60',
};

const spinner = (
  <svg
    className="animate-spin h-5 w-5 text-white"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
    />
  </svg>
);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseDate(value) {
  if (!value) return undefined;
  const isoPattern = /(\d{4})[-/.](\d{2})[-/.](\d{2})/;
  const friendlyPattern = /(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/;

  const isoMatch = value.match(isoPattern);
  if (isoMatch) {
    const [_, y, m, d] = isoMatch;
    return `${y}-${m}-${d}`;
  }

  const friendlyMatch = value.match(friendlyPattern);
  if (friendlyMatch) {
    const [_, d, mName, y] = friendlyMatch;
    const date = new Date(`${mName} ${d}, ${y}`);
    if (!Number.isNaN(date.getTime())) {
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${date.getFullYear()}-${month}-${day}`;
    }
  }
  return undefined;
}

function localExtractor(rawText) {
  const name = rawText.match(/Name\s*[:\-]\s*([A-Za-z ,.'-]+)/i)?.[1]?.trim();
  const passport =
    rawText.match(/Passport\s*No\.?\s*[:\-]?\s*([A-Z0-9]+)/i)?.[1]?.trim() ||
    rawText.match(/Document\s*ID\s*[:\-]\s*([A-Z0-9]+)/i)?.[1]?.trim();
  const date =
    parseDate(rawText.match(/Issue\s*Date\s*[:\-]\s*([\w\s.-]+)/i)?.[1]?.trim() || '') ||
    parseDate(rawText.match(/Issued\s*on\s*([\w\s.-]+)/i)?.[1]?.trim() || '');

  return {
    applicantName: name || 'UNKNOWN',
    documentId: passport || 'UNKNOWN',
    issueDate: date || 'UNKNOWN',
    source: 'local-extractor',
  };
}

async function callGemini(prompt, apiKey) {
  if (!apiKey) return null;
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=' +
    apiKey;
  const maxAttempts = 3;
  let delayMs = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini request failed with status ${response.status}`);
      }

      const payload = await response.json();
      const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini returned an empty response');
      }
      return JSON.parse(text);
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await delay(delayMs);
      delayMs *= 2;
    }
  }
  return null;
}

function buildPrompt(rawText) {
  return `Act as an Intelligent Document Processing (IDP) engine. Only return a JSON object matching this schema: ${JSON.stringify(
    schemaDescription
  )}. Use ISO date format (YYYY-MM-DD) for issueDate. Raw text to extract from:\n\n${rawText}`;
}

export default function App() {
  const [rawText, setRawText] = useState(DEFAULT_TEXT);
  const [artifact, setArtifact] = useState(null);
  const [status, setStatus] = useState({ tone: 'info', message: 'Ready to extract structured fields from your document text.' });
  const [processing, setProcessing] = useState(false);

  const apiKey = useMemo(() => import.meta.env.VITE_GEMINI_API_KEY || '', []);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.rawText) {
          setRawText(parsed.rawText);
        }
        if (parsed.artifact) {
          setArtifact(parsed.artifact);
          setStatus({ tone: 'success', message: 'Loaded saved artifact from localStorage.' });
        }
      }
    } catch (error) {
      console.error('Failed to load cached artifact', error);
    }
  }, []);

  useEffect(() => {
    const payload = { rawText, artifact };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error('Failed to persist artifact', error);
    }
  }, [rawText, artifact]);

  const handleProcess = async () => {
    setProcessing(true);
    setStatus({ tone: 'info', message: 'Processing document with IDP extraction pipeline...' });

    const prompt = buildPrompt(rawText);
    let structured;
    let usedGemini = false;
    let fallbackReason = '';

    try {
      const llmResult = await callGemini(prompt, apiKey);
      if (llmResult) {
        structured = { ...llmResult, source: 'gemini-2.5-flash-preview-09-2025' };
        usedGemini = true;
      } else {
        structured = localExtractor(rawText);
        fallbackReason = 'Gemini API key not provided; used offline extractor.';
      }
    } catch (error) {
      console.error('Gemini extraction failed; using local extractor', error);
      structured = localExtractor(rawText);
      fallbackReason = 'Gemini API unavailable; used local extractor with the latest document text.';
    }

    const result = {
      ...structured,
      rawText,
      processedAt: new Date().toISOString(),
    };
    setArtifact(result);

    if (usedGemini) {
      setStatus({ tone: 'success', message: 'Extraction completed using the Gemini API.' });
    } else if (fallbackReason) {
      setStatus({ tone: 'warning', message: fallbackReason });
    } else {
      setStatus({ tone: 'success', message: 'Extraction completed with the built-in parser (offline fallback).' });
    }
    setProcessing(false);
  };

  const schemaList = schemaDescription.map((item) => (
    <li key={item.field} className="flex items-start gap-3">
      <div className="mt-1 h-2 w-2 rounded-full bg-emerald-400" />
      <div>
        <p className="text-sm font-semibold text-white">{item.field}</p>
        <p className="text-xs text-slate-300">{item.description}</p>
        <p className="text-[11px] uppercase tracking-wide text-slate-400">{item.type + (item.format ? ` (${item.format})` : '')}</p>
      </div>
    </li>
  ));

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-emerald-300 uppercase tracking-[0.35em]">IDP KYC MVP</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-white">Intelligent Document Processing</h1>
          <span className="rounded-full bg-emerald-500/10 text-emerald-200 px-4 py-1 text-sm border border-emerald-500/40">
            Version 1.1-localStorage
          </span>
        </div>
        <p className="text-slate-300 text-sm max-w-3xl">
          Upload document OCR text, run IDP extraction via Gemini (with exponential backoff), and persist the latest artifact in browser
          localStorage—all inside a single React component.
        </p>
      </header>

      <section className={`${statusThemes[status.tone]} rounded-xl p-4 shadow-lg flex items-center gap-3`}>
        <div className="text-lg">{status.tone === 'success' ? '✅' : status.tone === 'warning' ? '⚠️' : 'ℹ️'}</div>
        <div>
          <p className="font-semibold text-white">Status</p>
          <p className="text-sm text-slate-200">{status.message}</p>
        </div>
      </section>

      <div className="grid md:grid-cols-5 gap-4">
        <section className="md:col-span-3 bg-slate-900/70 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Document Ingestion</p>
              <h2 className="text-xl font-semibold text-white">Raw OCR Input</h2>
            </div>
            {processing && <div className="flex items-center gap-2 text-xs text-emerald-200">{spinner}<span>Processing</span></div>}
          </div>
          <textarea
            className="w-full h-64 rounded-lg bg-slate-950/70 border border-slate-800 text-slate-100 text-sm p-3 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-60"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            disabled={processing}
            placeholder="Paste OCR output here"
          />
          <button
            onClick={handleProcess}
            disabled={processing}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-emerald-500 text-slate-950 font-semibold shadow-lg hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {processing ? (
              <>
                {spinner}
                <span>Running IDP Extraction</span>
              </>
            ) : (
              <>
                <span>Run IDP Extraction</span>
              </>
            )}
          </button>
          <p className="text-xs text-slate-400">
            Processing uses Gemini when a <code className="bg-slate-800 px-1 py-[1px] rounded">VITE_GEMINI_API_KEY</code> is provided. Otherwise, a deterministic
            offline parser is used. All artifacts and the current document text are persisted immediately to localStorage.
          </p>
        </section>

        <section className="md:col-span-2 bg-slate-900/70 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col gap-3">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Structured Output</p>
          <h2 className="text-xl font-semibold text-white">Latest Artifact</h2>
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3 text-sm text-emerald-100 min-h-[180px] font-mono overflow-x-auto">
            {artifact ? <pre className="whitespace-pre-wrap">{JSON.stringify(artifact, null, 2)}</pre> : <p className="text-slate-400">No artifact yet. Run extraction to see results.</p>}
          </div>
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-emerald-400" />
              <p className="font-semibold text-white">Structured Output Schema</p>
            </div>
            <ul className="space-y-2">{schemaList}</ul>
          </div>
          <div className="bg-amber-500/10 border border-amber-400/50 text-amber-100 rounded-lg p-3 text-xs">
            UI controls are disabled and a spinner appears during processing to honor the architectural constraint for active feedback.
          </div>
        </section>
      </div>
    </div>
  );
}
