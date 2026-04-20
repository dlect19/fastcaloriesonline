UPDATE public.legal_documents
SET content = content || E'\n\n<h2>7. Camera Access</h2>\n<p>FastCalories uses camera access only to scan QR codes for food ordering. We do not store or share camera data. User privacy is important to us, and all data is handled securely.</p>',
    updated_at = now()
WHERE document_type = 'privacy' AND is_current = true;