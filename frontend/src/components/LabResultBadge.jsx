import { CheckCircle, XCircle, Clock } from 'lucide-react';

type Status = 'ready' | 'pending' | 'review';

interface Props {
  status: Status;
  label: string;
}

/**
 * สีสอดคล้องกับสถานะ:
 * - ready   → green‑600 (check)
 * - pending → amber‑500 (clock)
 * - review  → red‑600   (x)
 */
export default function LabResultBadge({ status, label }: Props) {
  const map: Record<Status, { Icon: typeof CheckCircle; color: string }> = {
    ready:   { Icon: CheckCircle,   color: 'text-green-600' },
    pending: { Icon: Clock,         color: 'text-amber-500' },
    review:  { Icon: XCircle,       color: 'text-red-600' },
  };
  const { Icon, color } = map[status];

  return (
    <div className={`flex items-center gap-1 px-2 py-1 rounded-md bg-white/30 dark:bg-black/30 ${color} backdrop-blur-sm border border-${color.split('-')[0]}-200`}> 
      <Icon size={16} className="stroke-current" />
      <span className="font-medium">{label}</span>
    </div>
  );
}
