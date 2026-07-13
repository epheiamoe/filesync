-- Add label column to credential_audit for API key management
ALTER TABLE credential_audit ADD COLUMN label TEXT;
