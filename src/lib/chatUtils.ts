import { format, isToday, isYesterday, differenceInMinutes, differenceInCalendarDays } from "date-fns";
import { Message } from "@/types/chat";

export function formatTimestamp(date: Date): string {
  return format(date, "HH:mm");
}

export function formatDateSeparator(date: Date): string {
  if (isToday(date)) return "TODAY";
  if (isYesterday(date)) return "YESTERDAY";
  return format(date, "d MMMM yyyy").toUpperCase();
}

export function formatChatListTime(date: Date): string {
  if (isToday(date)) return format(date, "HH:mm");
  if (isYesterday(date)) return "Yesterday";
  const days = differenceInCalendarDays(new Date(), date);
  if (days < 7) return format(date, "EEEE");
  return format(date, "dd/MM/yy");
}

/** Returns gap in px based on time between messages (time-mapped spacing) */
export function getTimeGap(prev: Message, curr: Message): number {
  const mins = differenceInMinutes(curr.timestamp, prev.timestamp);
  if (mins < 2) return 8;
  if (mins < 15) return 16;
  if (mins < 60) return 32;
  if (mins < 240) return 56;
  return 80;
}

export function shouldShowDateSeparator(prev: Message | null, curr: Message): boolean {
  if (!prev) return true;
  return differenceInCalendarDays(curr.timestamp, prev.timestamp) >= 1;
}
