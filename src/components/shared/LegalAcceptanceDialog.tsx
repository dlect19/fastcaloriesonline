import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Shield, Loader2 } from 'lucide-react';

interface LegalDocument {
  id: string;
  document_type: string;
  title: string;
  content: string;
  version: number;
}

interface LegalAcceptanceDialogProps {
  open: boolean;
  documents: LegalDocument[];
  accepting: boolean;
  onAcceptAll: () => Promise<boolean>;
}

export function LegalAcceptanceDialog({ open, documents, accepting, onAcceptAll }: LegalAcceptanceDialogProps) {
  const [agreed, setAgreed] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  if (documents.length === 0) return null;

  const currentDoc = documents[currentIndex];
  const isLast = currentIndex === documents.length - 1;

  const handleAccept = async () => {
    if (isLast) {
      await onAcceptAll();
    } else {
      setCurrentIndex(prev => prev + 1);
      setAgreed(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            {currentDoc?.title}
          </DialogTitle>
          <DialogDescription>
            Please review and accept to continue ({currentIndex + 1} of {documents.length})
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[50vh] border rounded-lg p-4">
          <div 
            className="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: currentDoc?.content || '' }}
          />
        </ScrollArea>

        <div className="flex items-start gap-2 py-2">
          <Checkbox
            id="accept-terms"
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
          />
          <label htmlFor="accept-terms" className="text-sm text-muted-foreground cursor-pointer leading-tight">
            I have read and agree to the {currentDoc?.title}
          </label>
        </div>

        <DialogFooter>
          <Button
            onClick={handleAccept}
            disabled={!agreed || accepting}
            className="w-full"
          >
            {accepting ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Processing...</>
            ) : isLast ? (
              'Accept & Continue'
            ) : (
              'Next Document'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
