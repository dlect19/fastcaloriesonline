import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BottomNav } from '@/components/home/BottomNav';
import { supabase } from '@/integrations/supabase/client';
import { useGeolocation } from '@/hooks/useGeolocation';
import { CoverageHero } from '@/components/coverage/CoverageHero';
import { CoverageAreaCards } from '@/components/coverage/CoverageAreaCards';
import { CoverageMapEmbed } from '@/components/coverage/CoverageMapEmbed';
import type { Json } from '@/integrations/supabase/types';

interface CoverageArea {
  id: string;
  name: string;
  color: string;
  polygon: Json;
  is_active: boolean;
}

export default function CoverageMap() {
  const navigate = useNavigate();
  const mapSectionRef = useRef<HTMLDivElement>(null);
  const [coverageAreas, setCoverageAreas] = useState<CoverageArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusAreaId, setFocusAreaId] = useState<string | null>(null);

  const { latitude, longitude, getCurrentPosition } = useGeolocation();

  useEffect(() => {
    const fetchAreas = async () => {
      try {
        const { data, error } = await supabase
          .from('coverage_areas')
          .select('id, name, color, polygon, is_active')
          .eq('is_active', true);
        if (error) throw error;
        setCoverageAreas(data || []);
      } catch (err) {
        console.error('Error fetching coverage areas:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAreas();
    getCurrentPosition();
  }, []);

  const scrollToMap = useCallback(() => {
    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleAreaClick = useCallback((area: CoverageArea) => {
    setFocusAreaId(area.id);
    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const clearFocus = useCallback(() => setFocusAreaId(null), []);

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="flex-shrink-0" onClick={() => navigate('/')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-lg font-bold text-foreground">Delivery Coverage</h1>
        </div>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Hero section */}
        <CoverageHero totalAreas={coverageAreas.length} onScrollToMap={scrollToMap} />

        {/* Coverage area cards */}
        {!loading && (
          <CoverageAreaCards areas={coverageAreas} onAreaClick={handleAreaClick} />
        )}

        {/* Map section */}
        <div ref={mapSectionRef}>
          {!loading && (
            <CoverageMapEmbed
              areas={coverageAreas}
              latitude={latitude}
              longitude={longitude}
              focusAreaId={focusAreaId}
              onClearFocus={clearFocus}
            />
          )}
        </div>

        {/* Bottom spacer for nav */}
        <div className="h-20" />
      </div>

      <BottomNav activeTab="coverage" />
    </div>
  );
}
