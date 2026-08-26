import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CandlestickChart, LineChart, AreaChart } from "lucide-react";
export type ChartType = 'candlestick' | 'line' | 'area';
interface ChartTypeSelectorProps {
  selectedType: ChartType;
  onTypeChange: (type: ChartType) => void;
  className?: string;
}
const chartTypes: { type: ChartType; label: string; icon: React.ReactNode }[] = [
  { type: 'candlestick', label: 'Candles', icon: <CandlestickChart className="h-4 w-4" /> },
  { type: 'line', label: 'Line', icon: <LineChart className="h-4 w-4" /> },
  { type: 'area', label: 'Area', icon: <AreaChart className="h-4 w-4" /> },
];
export default function ChartTypeSelector({ selectedType, onTypeChange, className }: ChartTypeSelectorProps) {
  const currentType = chartTypes.find(t => t.type === selectedType) || chartTypes[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground h-8 w-8 px-0 ${className || ''}`}
          title={currentType.label}
        >
          {currentType.icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="bg-card border-border min-w-[140px]"
      >
        {chartTypes.map((chartType) => (
          <DropdownMenuItem
            key={chartType.type}
            onClick={() => onTypeChange(chartType.type)}
            className={`flex items-center gap-2 cursor-pointer ${selectedType === chartType.type ? 'bg-foreground/10 text-foreground font-medium' : ''
              }`}
          >
            {chartType.icon}
            <span>{chartType.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
