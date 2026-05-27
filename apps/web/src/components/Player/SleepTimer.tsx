import { Moon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Select } from '../ui/Input';

export function SleepTimer({ onExpire }: { onExpire: () => void }) {
  const [minutes, setMinutes] = useState(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState('Off');

  useEffect(() => {
    if (!deadline) {
      setRemaining('Off');
      return;
    }
    const timer = window.setInterval(() => {
      const ms = deadline - Date.now();
      if (ms <= 0) {
        setDeadline(null);
        onExpire();
        return;
      }
      setRemaining(`${Math.ceil(ms / 60000)}m`);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deadline, onExpire]);

  return (
    <div className="flex items-center gap-2" aria-label="Sleep timer">
      <Moon size={16} className="text-yellow" aria-hidden />
      <Select aria-label="Sleep timer duration" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} className="h-8 w-24 text-xs">
        <option value={0}>Off</option>
        <option value={5}>5m</option>
        <option value={10}>10m</option>
        <option value={15}>15m</option>
        <option value={30}>30m</option>
        <option value={45}>45m</option>
        <option value={60}>60m</option>
      </Select>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (minutes <= 0) setDeadline(null);
          else setDeadline(Date.now() + minutes * 60000);
        }}
      >
        {remaining}
      </Button>
    </div>
  );
}
