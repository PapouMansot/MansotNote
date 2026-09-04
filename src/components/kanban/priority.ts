/**
 * Métadonnées d'affichage des priorités Kanban.
 */
import type { Priority } from '@/types';

export const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
  low: { label: 'Basse', color: '#64748b' },
  medium: { label: 'Moyenne', color: '#3b82f6' },
  high: { label: 'Haute', color: '#f59e0b' },
  urgent: { label: 'Urgente', color: '#ef4444' },
};

export const PRIORITY_ORDER: Priority[] = ['low', 'medium', 'high', 'urgent'];
