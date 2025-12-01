# Intelligent Document Processing (IDP) KYC MVP Specification

**Version:** 1.1-localStorage

## Goal
To create a single-page web application demonstrating the end-to-end workflow of uploading document data, processing it using an LLM to extract structured fields, and persisting the results using browser local storage.

## Technical Stack
- **Frontend:** React.js (Single Component) — User interface and state management.
- **Styling:** Tailwind CSS — Utility-first framework for responsive and modern aesthetics.
- **AI/Processing:** Gemini API (gemini-2.5-flash-preview-09-2025) — Structured data extraction using JSON schema (IDP simulation).
- **Persistence:** Browser Local Storage — Non-persistent, client-side storage of the latest processed document artifact.

## Core Features
### Document Ingestion
- A dedicated `<textarea>` input area simulates the raw OCR output from a document image.
- Pre-populated mock data (e.g., Passport details) is provided for immediate testing.
- A "Run IDP Extraction" button initiates the processing workflow.

### AI Processing & Extraction
- The model is instructed to act as an IDP engine and return **only** a structured JSON object.
- Structured output schema:
  - `applicantName` (STRING): The full name of the applicant.
  - `documentId` (STRING): The unique document identification number.
  - `issueDate` (STRING, format `YYYY-MM-DD`): The date the document was issued.
- Implements an exponential backoff mechanism for API retries to handle transient errors.

### Data Persistence
- **Mechanism:** HTML5 `localStorage`.
- **Storage Key:** `kyc_artifact_data`.
- **Data Format:** The entire artifact object is `JSON.stringify`'d before being saved and `JSON.parse`'d on retrieval.
- **Loading Behavior:** The application must load the saved artifact data from `localStorage` upon initial component mounting.

## Architectural Constraints
- **Single-File Mandate:** The entire application logic is contained within a single `.jsx` file.
- **Immediate Persistence:** All processing results and the current document text must be immediately stored in `localStorage`.
- **UI Feedback:** The UI must be disabled and show a loading spinner during the `processing` state.
- **No Native Alerts:** Custom UI elements are used for all messaging (e.g., status card).

## Running the MVP
1. Install dependencies (requires access to npm registry):
   ```bash
   npm install
   ```
2. (Optional) Export a Gemini API key to enable live extraction:
   ```bash
   export VITE_GEMINI_API_KEY=your_key_here
   ```
   Without a key, the app falls back to an offline parser that still respects the schema.
3. Start the dev server:
   ```bash
   npm run dev
   ```
4. Build for GitHub Pages / static hosting:
   ```bash
   npm run build
   ```

The single React component in `src/App.jsx` covers ingestion, processing with exponential backoff, structured output rendering, and localStorage persistence in accordance with the specification.
