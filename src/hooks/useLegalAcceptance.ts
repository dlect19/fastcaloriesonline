import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface LegalDocument {
  id: string;
  document_type: string;
  title: string;
  content: string;
  version: number;
  force_reaccept: boolean;
}

export function useLegalAcceptance(userId: string | undefined, role: string) {
  const [pendingDocuments, setPendingDocuments] = useState<LegalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  // Which document types each role must accept
  const requiredTypes: Record<string, string[]> = {
    customer: ['terms', 'privacy'],
    vendor: ['terms', 'privacy', 'vendor_agreement'],
    rider: ['terms', 'privacy', 'rider_agreement'],
    logistics: ['terms', 'privacy', 'logistics_agreement'],
  };

  const types = requiredTypes[role] || ['terms', 'privacy'];

  useEffect(() => {
    if (userId) {
      checkAcceptance();
    }
  }, [userId, role]);

  const checkAcceptance = async () => {
    if (!userId) return;
    setLoading(true);

    try {
      // Get current versions of required documents
      const { data: docs } = await supabase
        .from('legal_documents')
        .select('*')
        .in('document_type', types)
        .eq('is_current', true);

      if (!docs || docs.length === 0) {
        setPendingDocuments([]);
        setLoading(false);
        return;
      }

      // Get user's acceptances
      const { data: acceptances } = await supabase
        .from('legal_acceptances')
        .select('document_id, document_version')
        .eq('user_id', userId);

      const acceptedDocIds = new Set(acceptances?.map(a => a.document_id) || []);

      // Find documents that need acceptance
      const pending = docs.filter(doc => {
        if (doc.force_reaccept) {
          // Check if accepted THIS version
          const accepted = acceptances?.find(a => a.document_id === doc.id);
          return !accepted;
        }
        return !acceptedDocIds.has(doc.id);
      });

      setPendingDocuments(pending as LegalDocument[]);
    } catch (error) {
      console.error('Error checking legal acceptance:', error);
    } finally {
      setLoading(false);
    }
  };

  const acceptDocument = async (documentId: string, documentType: string, documentVersion: number) => {
    if (!userId) return false;
    setAccepting(true);

    try {
      const { error } = await supabase
        .from('legal_acceptances')
        .upsert({
          user_id: userId,
          document_id: documentId,
          document_type: documentType,
          document_version: documentVersion,
          role,
          user_agent: navigator.userAgent,
        }, { onConflict: 'user_id,document_id' });

      if (error) throw error;

      // Remove from pending
      setPendingDocuments(prev => prev.filter(d => d.id !== documentId));
      return true;
    } catch (error) {
      console.error('Error accepting document:', error);
      return false;
    } finally {
      setAccepting(false);
    }
  };

  const acceptAll = async () => {
    for (const doc of pendingDocuments) {
      const success = await acceptDocument(doc.id, doc.document_type, doc.version);
      if (!success) return false;
    }
    return true;
  };

  return {
    pendingDocuments,
    hasPendingAcceptance: pendingDocuments.length > 0,
    loading,
    accepting,
    acceptDocument,
    acceptAll,
    refresh: checkAcceptance,
  };
}
