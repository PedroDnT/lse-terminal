import { useState, useEffect, useCallback } from 'react';
import { generateUUID } from '@/lib/uuid';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Drawing } from '@/components/chart/ChartDrawingOverlay';
import { IndicatorConfig } from '@/components/chart/IndicatorSettings';
import { toast } from 'sonner';

export interface ChartLayout {
  id?: string;
  name: string;
  symbol: string;
  timeframe: string;
  indicators: Partial<IndicatorConfig>;
  drawings: Drawing[];
  chart_settings?: Record<string, unknown>;
  is_default?: boolean;
  created_at?: string;
  updated_at?: string;
}

// localStorage fallback for anonymous users removed in line with
// the rest of the per-user-state migration (priceAlerts, advancedAlerts,
// watchlist, useUserPref). Anonymous users see in-memory layouts that reset
// on refresh; signing in loads the real layouts from chart_layouts.
const MAX_LAYOUTS = 25;

export function useChartLayouts() {
  const { user } = useAuth();
  const [layouts, setLayouts] = useState<ChartLayout[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchLayouts = useCallback(async () => {
    if (!user) {
      // Anonymous users get an in-memory empty list. Sign in to load
      // saved layouts from the chart_layouts table.
      setLayouts([]);
      return;
    }

    setIsLoading(true);
    try {
      const data = await api.getChartLayouts();

      // Map API response - layout_data is a JSONB column containing symbol, timeframe, etc.
      setLayouts(
        (data || []).map((row: any) => {
          const layoutData = row.layout_data || {};
          return {
            id: row.id,
            name: row.name,
            symbol: layoutData.symbol || '',
            timeframe: layoutData.timeframe || '1h',
            indicators: (layoutData.indicators as IndicatorConfig) || {},
            drawings: (layoutData.drawings as Drawing[]) || [],
            chart_settings: layoutData.chart_settings,
            is_default: layoutData.is_default,
            created_at: row.created_at,
            updated_at: row.updated_at,
          };
        })
      );
    } catch (error) {
      console.error('Error fetching chart layouts:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchLayouts();
  }, [fetchLayouts]);

  const saveLayout = async (layout: Omit<ChartLayout, 'id' | 'created_at' | 'updated_at'>): Promise<boolean> => {
    // Check if this is a new layout
    const existingLayout = layouts.find(l => l.name === layout.name);

    if (!existingLayout && layouts.length >= MAX_LAYOUTS) {
      toast.error(`Maximum of ${MAX_LAYOUTS} layouts reached. Please delete a layout first.`);
      return false;
    }

    if (!user) {
      // Anonymous: in-memory only. Save survives this session; refresh
      // wipes. Toast tells the user to sign in to persist.
      const newLayout: ChartLayout = {
        ...layout,
        id: existingLayout?.id || generateUUID(),
        created_at: existingLayout?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setLayouts(prev => [...prev.filter(l => l.name !== layout.name), newLayout]);
      toast.success(`Chart layout "${layout.name}" saved (sign in to keep across refreshes)`);
      return true;
    }

    try {
      // Always upsert - the API handles insert/update based on unique constraint (firebase_uid, name)
      await api.upsertChartLayout({
        name: layout.name,
        layout_data: {
          symbol: layout.symbol,
          timeframe: layout.timeframe,
          indicators: layout.indicators,
          drawings: layout.drawings,
          chart_settings: layout.chart_settings || {},
          is_default: layout.is_default || false,
        }
      });

      await fetchLayouts();
      toast.success(`Chart layout "${layout.name}" saved`);
      return true;
    } catch (error: any) {
      console.error('Error saving chart layout:', error);
      toast.error('Failed to save chart layout');
      return false;
    }
  };

  const deleteLayout = async (nameOrId: string): Promise<boolean> => {
    if (!user) {
      setLayouts(prev => prev.filter(l => l.name !== nameOrId && l.id !== nameOrId));
      toast.success(`Chart layout deleted`);
      return true;
    }

    try {
      // Find the layout to get its ID
      const layout = layouts.find(l => l.name === nameOrId || l.id === nameOrId);
      if (layout?.id) {
        await api.deleteChartLayout(layout.id);
      }
      await fetchLayouts();
      toast.success(`Chart layout deleted`);
      return true;
    } catch (error: any) {
      console.error('Error deleting chart layout:', error);
      toast.error('Failed to delete chart layout');
      return false;
    }
  };

  const getLayoutByName = useCallback((name: string): ChartLayout | undefined => {
    return layouts.find(l => l.name === name);
  }, [layouts]);

  return {
    layouts,
    isLoading,
    saveLayout,
    deleteLayout,
    getLayoutByName,
    refreshLayouts: fetchLayouts,
  };
}
