export function cn(...args: (string | false | null | undefined | 0)[]): string {
  return args.filter(Boolean).join(' ');
}
