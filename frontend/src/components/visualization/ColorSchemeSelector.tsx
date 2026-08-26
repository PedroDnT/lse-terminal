import { COLOR_SCHEMES, ColorScheme } from './types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

interface ColorSchemeSelectorProps {
  value: string;
  onChange: (scheme: ColorScheme) => void;
}

export default function ColorSchemeSelector({ value, onChange }: ColorSchemeSelectorProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Color Scheme</Label>
      <Select
        value={value}
        onValueChange={(id) => {
          const scheme = COLOR_SCHEMES.find(s => s.id === id);
          if (scheme) onChange(scheme);
        }}
      >
        <SelectTrigger className="w-full h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COLOR_SCHEMES.map((scheme) => (
            <SelectItem key={scheme.id} value={scheme.id}>
              <div className="flex items-center gap-2">
                <div className="flex h-4 w-16 rounded overflow-hidden">
                  {scheme.colors.slice(0, 5).map((color, i) => (
                    <div 
                      key={i} 
                      className="flex-1" 
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <span>{scheme.name}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
