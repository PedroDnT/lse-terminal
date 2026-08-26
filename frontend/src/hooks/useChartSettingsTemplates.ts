import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { ChartSettings } from '@/components/chart/ChartSettingsDialog';
import { toast } from 'sonner';

export interface Template {
  name: string;
  settings: ChartSettings;
}

export type TemplateSlots = (Template | null)[];

// Storage is split cleanly by auth state.
//
//   - Anonymous: localStorage only. Stays exactly where you left it on
//     this tab; reset on a hard cache clear.
//   - Signed-in: API only (chart_settings_templates table). No localStorage
//     mirror. Previously we wrote-through to both, but the dual write meant
//     a stale localStorage from a previous signed-in session could leak
//     into the next signed-in session and overwrite the server copy. Now
//     each path is the single source of truth for its own auth state, and
//     sign-out clears the localStorage key so the next signed-in user
//     doesn't inherit anything.
//
// Init race: if a signed-in user edits a slot while the initial API load
// is in flight, the late fetch is dropped (userTouchedSinceLoad guard).
const LOCAL_STORAGE_KEY = 'chartSettingsTemplates';
const MAX_TEMPLATES = 5;

function emptySlots(): TemplateSlots {
  return [null, null, null, null, null];
}

function readLocalSlots(): TemplateSlots {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return emptySlots();
    const parsed = JSON.parse(raw);
    const slots = emptySlots();
    for (let i = 0; i < MAX_TEMPLATES; i++) slots[i] = parsed[i] || null;
    return slots;
  } catch {
    return emptySlots();
  }
}

function writeLocalSlots(slots: TemplateSlots) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // quota or private-mode; ignore
  }
}

function clearLocalSlots() {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function useChartSettingsTemplates() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [templates, setTemplates] = useState<TemplateSlots>(emptySlots);
  const [isLoading, setIsLoading] = useState(true);
  const [isSynced, setIsSynced] = useState(false);
  const userTouchedSinceLoad = useRef(false);

  // Refresh from the canonical source for the current auth state.
  const fetchTemplates = useCallback(async () => {
    userTouchedSinceLoad.current = false;

    if (!uid) {
      // Anonymous: localStorage is canonical.
      setTemplates(readLocalSlots());
      setIsLoading(false);
      setIsSynced(false);
      return;
    }

    // Signed-in: API is canonical. Never read localStorage in this branch.
    setIsLoading(true);
    try {
      const data = await api.getChartSettingsTemplates();
      // Race guard: if the user has saved a slot since this fetch started,
      // the in-memory state is fresher than the DB. Drop the load.
      if (userTouchedSinceLoad.current) return;
      const slots = emptySlots();
      if (data?.templates) {
        for (let i = 0; i < MAX_TEMPLATES; i++) slots[i] = data.templates[i] || null;
      }
      setTemplates(slots);
      setIsSynced(true);
    } catch (error) {
      console.error('[chart-settings-templates] API load failed; defaulting to empty:', error);
      if (!userTouchedSinceLoad.current) setTemplates(emptySlots());
      setIsSynced(false);
    } finally {
      setIsLoading(false);
    }
  }, [uid]);

  // Initial load + reload on sign-in / sign-out.
  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Clear the localStorage mirror once on sign-in, so a logged-in session
  // doesn't accidentally inherit anonymous templates that were left behind
  // on this device. Anonymous tabs keep their own localStorage untouched.
  useEffect(() => {
    if (uid) clearLocalSlots();
  }, [uid]);

  const saveTemplates = useCallback(async (newTemplates: TemplateSlots): Promise<boolean> => {
    userTouchedSinceLoad.current = true;
    setTemplates(newTemplates);

    if (!uid) {
      writeLocalSlots(newTemplates);
      return true;
    }

    try {
      await api.upsertChartSettingsTemplates(newTemplates);
      setIsSynced(true);
      return true;
    } catch (error) {
      console.error('[chart-settings-templates] API save failed:', error);
      toast.error('Failed to sync templates to cloud');
      setIsSynced(false);
      return false;
    }
  }, [uid]);

  const saveTemplate = useCallback(async (slotIndex: number, template: Template): Promise<boolean> => {
    const updated = [...templates];
    updated[slotIndex] = template;
    return saveTemplates(updated);
  }, [templates, saveTemplates]);

  const deleteTemplate = useCallback(async (slotIndex: number): Promise<boolean> => {
    const updated = [...templates];
    updated[slotIndex] = null;
    return saveTemplates(updated);
  }, [templates, saveTemplates]);

  const updateTemplateName = useCallback(async (slotIndex: number, newName: string): Promise<boolean> => {
    const template = templates[slotIndex];
    if (!template) return false;
    const updated = [...templates];
    updated[slotIndex] = { ...template, name: newName };
    return saveTemplates(updated);
  }, [templates, saveTemplates]);

  return {
    templates,
    isLoading,
    isSynced,
    saveTemplate,
    deleteTemplate,
    updateTemplateName,
    refreshTemplates: fetchTemplates,
  };
}
