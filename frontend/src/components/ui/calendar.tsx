import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { format, setMonth, setYear } from "date-fns";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  const [displayMonth, setDisplayMonth] = React.useState<Date>(
    props.defaultMonth || props.selected as Date || new Date()
  );

  // Generate years from 2000 to current year + 5
  const currentYear = new Date().getFullYear();
  const years = React.useMemo(() => {
    const result: number[] = [];
    for (let year = 2000; year <= currentYear + 5; year++) {
      result.push(year);
    }
    return result;
  }, [currentYear]);

  const handleMonthChange = (monthStr: string) => {
    const monthIndex = parseInt(monthStr, 10);
    const newDate = setMonth(displayMonth, monthIndex);
    setDisplayMonth(newDate);
  };

  const handleYearChange = (yearStr: string) => {
    const year = parseInt(yearStr, 10);
    const newDate = setYear(displayMonth, year);
    setDisplayMonth(newDate);
  };

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      month={displayMonth}
      onMonthChange={setDisplayMonth}
      className={cn("p-3 pointer-events-auto", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "hidden",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100",
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day: cn(buttonVariants({ variant: "ghost" }), "h-9 w-9 p-0 font-normal aria-selected:opacity-100"),
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside:
          "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ ..._props }) => <ChevronLeft className="h-4 w-4" />,
        IconRight: ({ ..._props }) => <ChevronRight className="h-4 w-4" />,
        Caption: ({ displayMonth: captionMonth }) => (
          <div className="flex justify-center gap-1 items-center">
            <Select
              value={captionMonth.getMonth().toString()}
              onValueChange={handleMonthChange}
            >
              <SelectTrigger className="h-7 w-[110px] text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60 z-[9999] pointer-events-auto">
                {MONTHS.map((month, index) => (
                  <SelectItem key={month} value={index.toString()} className="text-xs">
                    {month}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={captionMonth.getFullYear().toString()}
              onValueChange={handleYearChange}
            >
              <SelectTrigger className="h-7 w-[75px] text-xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60 z-[9999] pointer-events-auto">
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()} className="text-xs">
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ),
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
