import React from 'react';
import { CheckCircle, XCircle, Clock } from 'lucide-react';

/**
 * Lab Result Badge
 * - ready / confirmed → green
 * - pending           → amber
 * - review / abnormal → red
 */
export default function LabResultBadge({ status = 'pending', label = 'Pending' }) {
  const map = {
    ready:     { Icon: CheckCircle, color: 'text-risk-low dark:text-risk-lowd bg-risk-low/[0.08] border-risk-low/30' },
    confirmed: { Icon: CheckCircle, color: 'text-risk-low dark:text-risk-lowd bg-risk-low/[0.08] border-risk-low/30' },
    pending:   { Icon: Clock,       color: 'text-risk-mod dark:text-risk-modd bg-risk-mod/[0.08] border-risk-mod/30' },
    review:    { Icon: XCircle,     color: 'text-risk-high dark:text-risk-highd bg-risk-high/[0.08] border-risk-high/30' },
  };

  const current = map[status] || map.pending;
  const { Icon, color } = current;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-medium border ${color}`}>
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </span>
  );
}
