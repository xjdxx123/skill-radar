export interface AnalysisInput {
  skillName: string;
  scope: string;
  skillMarkdown: string;
  candidatePrompts: string[];
  siblingSkills: { name: string; description: string | null }[];
}

const SCHEMA_INSTRUCTION = `Output ONLY a single JSON object (no prose, no markdown fences) with this shape:
{
  "trulyMissed": boolean,            // did this skill genuinely apply to the prompts below but fail to fire?
  "verdictReasoning": string,
  "overallConfidence": "high" | "medium" | "low",
  "facets": [                         // include only facets you have a concrete improvement for
    { "facet": "summary" | "description" | "triggers" | "nonGoals" | "disambiguation" | "name",
      "diagnosis": string,           // why the current wording fails to get this skill selected
      "suggestion": string,          // concrete replacement text / guidance
      "confidence": "high" | "medium" | "low" }
  ]
}
Facets: summary = one-line capability; description = the frontmatter routing line; triggers = "use when" phrases mined from the prompts; nonGoals = "do NOT use when" boundaries; disambiguation = how to choose this vs the sibling skills below; name = only if a rename reduces collision/ambiguity.`;

function clamp(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '\n…(truncated)' : s;
}

export function buildAnalysisPrompt(input: AnalysisInput): string {
  const prompts = input.candidatePrompts.length
    ? input.candidatePrompts.map((p, i) => `  ${i + 1}. ${clamp(p.replace(/\s+/g, ' ').trim(), 400)}`).join('\n')
    : '  (none)';
  const siblings = input.siblingSkills.length
    ? input.siblingSkills.map((s) => `  - ${s.name}: ${clamp((s.description ?? '').replace(/\s+/g, ' ').trim(), 140)}`).join('\n')
    : '  (none)';

  return `You are an expert at optimizing how an AI coding agent (Claude Code) selects its installed Skills.
A Skill is invoked when the model judges, from its frontmatter "description", that it applies. The skill below is
available but is being IGNORED — the user wrote prompts it seemingly should have handled, yet it never fired.

Diagnose why its wording fails to get it selected, and propose concrete fixes. Be specific and conservative;
only include a facet when you have a real improvement.

## Target skill: ${input.skillName} (scope: ${input.scope})

### Its SKILL.md
${clamp(input.skillMarkdown || '(no SKILL.md content available)', 6000)}

### Prompts where it seemingly should have fired but did not
${prompts}

### Sibling skills (for disambiguation — do not suggest overlapping triggers with these)
${siblings}

## Your output
${SCHEMA_INSTRUCTION}`;
}
