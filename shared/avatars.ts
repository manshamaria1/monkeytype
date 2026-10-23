/** Built-in avatars (emoji, so no image hosting or uploads are needed). */
export const AVATARS = [
  { id: "monkey", emoji: "🐒" },
  { id: "fox", emoji: "🦊" },
  { id: "cat", emoji: "🐱" },
  { id: "owl", emoji: "🦉" },
  { id: "panda", emoji: "🐼" },
  { id: "tiger", emoji: "🐯" },
  { id: "frog", emoji: "🐸" },
  { id: "octopus", emoji: "🐙" },
  { id: "robot", emoji: "🤖" },
  { id: "rocket", emoji: "🚀" },
  { id: "keyboard", emoji: "⌨️" },
  { id: "star", emoji: "⭐" },
] as const;

export function avatarEmoji(id: string | null | undefined): string {
  return AVATARS.find((a) => a.id === id)?.emoji ?? "🐒";
}
