const MAX_MESSAGE_LENGTH = 1500;

const MARKDOWN_REMOVALS: [RegExp, string][] = [
  [/!\[.*?\]\(.*?\)/g, ""],           // ![alt](url)
  [/\[([^\]]+)\]\(([^)]+)\)/g, "$2"], // [text](url) → just URL
  [/^#{1,6}\s+/gm, ""],              // # headers
  [/```[\s\S]*?```/g, ""],           // code blocks
  [/\*\*([^*]+)\*\*/g, "*$1*"],      // **bold** → *bold*
  [/_{2}([^_]+)_{2}/g, "_$1_"],      // __text__ → _text_
  [/^[-*]\s/gm, "• "],              // - or * list → •
];

export function formatGuard(text: string): string {
  let result = text;

  // Remove non-WhatsApp markdown
  for (const [pattern, replacement] of MARKDOWN_REMOVALS) {
    result = result.replace(pattern, replacement);
  }

  // Truncate if too long
  if (result.length > MAX_MESSAGE_LENGTH) {
    result = result.substring(0, MAX_MESSAGE_LENGTH - 3) + "...";
  }

  return result.trim();
}
