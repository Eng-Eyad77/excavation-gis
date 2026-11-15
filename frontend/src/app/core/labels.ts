import { ExcavationStatus } from './models';

/** Arabic display labels for values stored in English in Oracle. */
export const WORK_TYPES = [
  { value: 'Fiber cable', label: 'كابلات ألياف ضوئية' },
  { value: 'Water pipeline', label: 'خط مياه' },
  { value: 'Sewage pipeline', label: 'خط صرف صحي' },
  { value: 'Electric cable', label: 'كابلات كهرباء' },
  { value: 'Gas pipeline', label: 'خط غاز' },
  { value: 'Road works', label: 'أعمال طرق' },
];

export const STATUS_LABELS: Record<ExcavationStatus, string> = {
  Pending: 'قيد المراجعة',
  Approved: 'معتمد',
  Rejected: 'مرفوض',
};

export function workTypeLabel(value: string): string {
  return WORK_TYPES.find((t) => t.value === value)?.label ?? value;
}
