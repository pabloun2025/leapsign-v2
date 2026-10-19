/** Explicit synthetic UI fixture. Not a v2 production entry or signing service. */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {SigningPanel} from '../../../src/v2/SigningPanel';
import {SigningWorkflow} from '../../../src/v2/signing-workflow';
import {LocalSigningError} from '../../../src/v2/local-session';
import {samplePdf} from './sample-pdf';

const pdf = samplePdf();
const position = {page: 2, x: 320, y: 20, width: 250, height: 80};
const flow = new SigningWorkflow({
  actorId: 'synthetic-person', origin: 'https://leapsign.app',
  flags: {DIRECT_P12_SIGNING_ENABLED: 'true', EXTERNAL_SIGNATURE_ENABLED: 'true', FIRMAEC_COMPATIBILITY_PROFILE_ENABLED: 'true'},
  api: {
    prepare: async () => {const now = Date.now(); return {pdf, filename: 'Acuerdo de colaboración.pdf', previousSignatureCount: 0,
      intent: {id: crypto.randomUUID(), documentId: 'synthetic-document', versionId: 'synthetic-version', stageId: 'synthetic-stage', signerId: 'synthetic-person', role: 'approval',
        profile: 'firmaec-qr-compatible', position, nonce: 'synthetic-only', state: 'signature_intent_issued', correlationId: crypto.randomUUID(),
        baseSha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pdf)), n => n.toString(16).padStart(2, '0')).join(''),
        issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300_000).toISOString()}};},
    submit: async () => {throw new Error('UI laboratory cannot validate or store signatures');},
  },
  localSigner: async () => {throw new LocalSigningError('LOCAL_FAILURE');},
});
createRoot(document.getElementById('root')!).render(<>
  <aside style={{background: '#fff0cd', color: '#573a0b', padding: '10px 24px', font: '13px sans-serif', textAlign: 'center'}}>Laboratorio de interfaz · Datos ficticios · No uses certificados reales</aside>
  <SigningPanel flow={flow} preparation={{documentId: 'synthetic-document', profile: 'firmaec-qr-compatible', position}} title="Acuerdo de colaboración"/>
</>);
