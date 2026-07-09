import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useUpdateSources } from '../hooks';
import type { SourcesConfig } from '@/types/models';

const SOURCE_LABELS: Record<keyof SourcesConfig, string> = {
  prodooh: 'Prodooh',
  gam: 'GAM',
  url: 'URL',
  playlist: 'Playlist',
};

interface SourceTogglesProps {
  screenId: string;
  sourcesConfig: SourcesConfig;
}

export function SourceToggles({ screenId, sourcesConfig }: SourceTogglesProps) {
  const updateSources = useUpdateSources(screenId);

  function handleToggle(source: keyof SourcesConfig, checked: boolean) {
    const newConfig: SourcesConfig = {
      ...sourcesConfig,
      [source]: checked,
    };
    updateSources.mutate(newConfig);
  }

  return (
    <div className="flex flex-wrap gap-6">
      {(Object.keys(SOURCE_LABELS) as Array<keyof SourcesConfig>).map((source) => (
        <div key={source} className="flex items-center gap-2">
          <Switch
            id={`source-${source}`}
            checked={sourcesConfig[source]}
            onCheckedChange={(checked) => handleToggle(source, checked)}
            disabled={updateSources.isPending}
          />
          <Label htmlFor={`source-${source}`} className="cursor-pointer">
            {SOURCE_LABELS[source]}
          </Label>
        </div>
      ))}
    </div>
  );
}
