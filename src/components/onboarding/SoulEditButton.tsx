import { useState } from 'react';
import { UserRoundPen } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { getSoul } from '@/lib/soul';
import { Button } from '@/components/ui/Button';
import { SoulOnboarding } from './SoulOnboarding';

/** Rouvre le questionnaire pour changer le nom, la personnalité ou le tutoiement. */
export function SoulEditButton() {
  const settings = useAppStore((s) => s.data.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [open, setOpen] = useState(false);
  const soul = getSoul(settings);
  return (
    <>
      <Button size="sm" variant="secondary" icon={<UserRoundPen size={14} />} onClick={() => setOpen(true)}>
        Personnaliser {soul.assistantName}
      </Button>
      {open && (
        <SoulOnboarding
          mode="edit"
          initial={soul}
          onSave={(next) => {
            updateSettings({ soul: next });
            setOpen(false);
          }}
          onSkip={() => setOpen(false)}
        />
      )}
    </>
  );
}
