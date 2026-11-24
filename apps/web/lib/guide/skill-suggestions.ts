// Common skill names offered while the owner types on the Skills step. The
// list only completes typing: nothing is added unless the owner picks it,
// and any other name can be entered as typed.
export const skillNames = [
  "Angular",
  "AWS",
  "Azure",
  "Bash",
  "C",
  "C#",
  "C++",
  "Cloudflare",
  "CSS",
  "Dart",
  "Django",
  "Docker",
  "Elixir",
  "Express",
  "Fastify",
  "Figma",
  "Firebase",
  "Flutter",
  "Git",
  "GitHub",
  "Go",
  "Google Cloud",
  "GraphQL",
  "HTML",
  "Java",
  "JavaScript",
  "Kotlin",
  "Kubernetes",
  "Laravel",
  "Linux",
  "MongoDB",
  "MySQL",
  "Next.js",
  "Node.js",
  "PHP",
  "PostgreSQL",
  "Python",
  "Rails",
  "React",
  "React Native",
  "Redis",
  "Ruby",
  "Rust",
  "Sass",
  "SQL",
  "SQLite",
  "Supabase",
  "Svelte",
  "Swift",
  "Tailwind CSS",
  "Terraform",
  "TypeScript",
  "UI design",
  "UX research",
  "Vercel",
  "Vue",
] as const;

// Names that start with the query come first, then names that contain it.
// Names the owner already entered are left out, ignoring case.
export function matchSkills(
  query: string,
  entered: readonly string[],
  limit = 3,
): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const taken = new Set(entered.map((name) => name.trim().toLowerCase()));
  const open = skillNames.filter((name) => !taken.has(name.toLowerCase()));
  const starts = open.filter((name) => name.toLowerCase().startsWith(needle));
  const contains = open.filter(
    (name) =>
      !name.toLowerCase().startsWith(needle) &&
      name.toLowerCase().includes(needle),
  );
  return [...starts, ...contains].slice(0, limit);
}
